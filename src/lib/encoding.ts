// Packs the persisted state into Telegram CloudStorage value(s).
//
// Primary scheme — single key `v1:state`:
//   <bitmask_base64url>|<year_pairs>
//   year_pairs := <idx36>:<yearOffset36>, comma-separated, sorted by idx
//   yearOffset := year - YEAR_EPOCH
//
// Safety valve — when payload > SHARD_THRESHOLD, the state key keeps only
// the mask and a header "|@C:N" and the year pairs spill across keys
// `v1:y:0`, `v1:y:1`, … up to MAX_SHARDS.

export const YEAR_EPOCH = 1900;
export const VALUE_CHAR_LIMIT = 4096; // Telegram CloudStorage limit
export const SHARD_THRESHOLD = 3900; // leave headroom under the limit
export const MAX_SHARDS = 4;
// Telegram CloudStorage restricts keys to `[A-Za-z0-9_-]` — colons are
// rejected silently, which is what made every save fail in production.
export const STATE_KEY = "v1_state";
export const SHARD_PREFIX = "v1_y_";

export type State = {
  visited: Uint8Array; // bitmask, length = ceil(N/8)
  years: Map<number, number>; // idx -> year (absolute, e.g. 2019)
};

export function emptyState(cityCount: number): State {
  return { visited: new Uint8Array(Math.ceil(cityCount / 8)), years: new Map() };
}

export function isVisited(state: State, idx: number): boolean {
  return (state.visited[idx >> 3]! & (1 << (idx & 7))) !== 0;
}

export function setVisited(state: State, idx: number, on: boolean): void {
  const b = idx >> 3;
  const m = 1 << (idx & 7);
  if (on) state.visited[b] = state.visited[b]! | m;
  else state.visited[b] = state.visited[b]! & ~m;
  if (!on) state.years.delete(idx);
}

export function visitedCount(state: State): number {
  let n = 0;
  for (const b of state.visited) {
    let v = b;
    while (v) { v &= v - 1; n++; }
  }
  return n;
}

// --- base64url for the bitmask ---

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function b64urlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64_ALPHABET[b0 >> 2]!;
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    if (i + 1 < bytes.length) out += B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]!;
    if (i + 2 < bytes.length) out += B64_ALPHABET[b2 & 0x3f]!;
  }
  return out;
}

function b64urlDecode(s: string, byteLen: number): Uint8Array {
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) lookup[B64_ALPHABET.charCodeAt(i)] = i;
  const out = new Uint8Array(byteLen);
  let oi = 0;
  for (let i = 0; i < s.length; i += 4) {
    const c0 = lookup[s.charCodeAt(i)] ?? -1;
    const c1 = lookup[s.charCodeAt(i + 1)] ?? -1;
    const c2 = i + 2 < s.length ? lookup[s.charCodeAt(i + 2)] ?? -1 : 0;
    const c3 = i + 3 < s.length ? lookup[s.charCodeAt(i + 3)] ?? -1 : 0;
    if (c0 < 0 || c1 < 0) break;
    if (oi < byteLen) out[oi++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < s.length && c2 >= 0 && oi < byteLen) out[oi++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (i + 3 < s.length && c3 >= 0 && oi < byteLen) out[oi++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}

// --- year pair string codec ---

function encodeYearPairs(entries: Array<[number, number]>): string {
  // entries already sorted by idx
  let out = "";
  for (let i = 0; i < entries.length; i++) {
    const [idx, year] = entries[i]!;
    if (i > 0) out += ",";
    out += idx.toString(36) + ":" + (year - YEAR_EPOCH).toString(36);
  }
  return out;
}

function decodeYearPairs(s: string): Array<[number, number]> {
  if (!s) return [];
  const out: Array<[number, number]> = [];
  for (const pair of s.split(",")) {
    const c = pair.indexOf(":");
    if (c < 0) continue;
    const idx = parseInt(pair.slice(0, c), 36);
    const off = parseInt(pair.slice(c + 1), 36);
    if (Number.isFinite(idx) && Number.isFinite(off)) out.push([idx, off + YEAR_EPOCH]);
  }
  return out;
}

// --- top-level pack/unpack ---

export type PackedShards = {
  state: string; // value for STATE_KEY
  shards: string[]; // values for v1:y:0, v1:y:1, ...
};

export function pack(state: State): PackedShards {
  const mask = b64urlEncode(state.visited);
  const entries = [...state.years.entries()].sort((a, b) => a[0] - b[0]);

  // Single-key attempt
  const singleYears = encodeYearPairs(entries);
  const single = singleYears ? `${mask}|${singleYears}` : mask;
  if (single.length <= SHARD_THRESHOLD) {
    return { state: single, shards: [] };
  }

  // Spill year pairs into shards. Pack greedily up to (VALUE_CHAR_LIMIT - 8)
  // chars per shard to leave some headroom for a future format extension.
  const shardLimit = VALUE_CHAR_LIMIT - 64;
  const shards: string[] = [];
  let buf = "";
  for (let i = 0; i < entries.length; i++) {
    const piece = (buf ? "," : "") +
      entries[i]![0].toString(36) + ":" + (entries[i]![1] - YEAR_EPOCH).toString(36);
    if (buf.length + piece.length > shardLimit) {
      shards.push(buf);
      buf = piece.replace(/^,/, "");
    } else {
      buf += piece;
    }
    if (shards.length >= MAX_SHARDS) {
      throw new Error(`Year pairs exceed ${MAX_SHARDS} shards — refusing to drop data`);
    }
  }
  if (buf) shards.push(buf);

  return { state: `${mask}|@C:${shards.length}`, shards };
}

export type Unpacked =
  | { mode: "single"; mask: string; years: string }
  | { mode: "sharded"; mask: string; shardCount: number };

export function parseStateValue(raw: string): Unpacked {
  const pipe = raw.indexOf("|");
  if (pipe < 0) return { mode: "single", mask: raw, years: "" };
  const mask = raw.slice(0, pipe);
  const rest = raw.slice(pipe + 1);
  if (rest.startsWith("@C:")) {
    return { mode: "sharded", mask, shardCount: parseInt(rest.slice(3), 10) || 0 };
  }
  return { mode: "single", mask, years: rest };
}

// --- share codec (for friend comparison) ---
//
// Encodes a user's whole state into a single string that fits into a Telegram
// chat message (~300–500 chars typical). Format:
//   lbdv1.<encName>.<maskB64>.<yearsCsv>
// encName: encodeURIComponent(name) with dots double-escaped so the dot
// delimiter is unambiguous; mask: same base64url bitmask used in CloudStorage;
// years: same idx36:yroff36 csv as the storage format.

export const SHARE_PREFIX = "lbdv1.";

export function encodeShareCode(state: State, name?: string | null): string {
  const mask = b64urlEncode(state.visited);
  const entries = [...state.years.entries()].sort((a, b) => a[0] - b[0]);
  const years = encodeYearPairs(entries);
  const encName = name ? encodeURIComponent(name).replace(/\./g, "%2E") : "";
  return `${SHARE_PREFIX}${encName}.${mask}.${years}`;
}

export type DecodedShare = { name: string | null; state: State };

export function decodeShareCode(cityCount: number, raw: string): DecodedShare | null {
  const s = raw.trim();
  if (!s.startsWith(SHARE_PREFIX)) return null;
  const body = s.slice(SHARE_PREFIX.length);
  const firstDot = body.indexOf(".");
  if (firstDot < 0) return null;
  const encName = body.slice(0, firstDot);
  const rest = body.slice(firstDot + 1);
  const secondDot = rest.indexOf(".");
  if (secondDot < 0) return null;
  const mask = rest.slice(0, secondDot);
  const years = rest.slice(secondDot + 1);
  if (!mask) return null;

  let name: string | null = null;
  if (encName) {
    try { name = decodeURIComponent(encName); } catch { return null; }
  }

  const state = emptyState(cityCount);
  try {
    state.visited = b64urlDecode(mask, Math.ceil(cityCount / 8));
  } catch {
    return null;
  }
  for (const [idx, year] of decodeYearPairs(years)) {
    if (idx >= 0 && idx < cityCount) state.years.set(idx, year);
  }
  return { name, state };
}

export function unpack(
  cityCount: number,
  stateRaw: string | undefined,
  shardLoader?: (i: number) => string | undefined,
): State {
  const out = emptyState(cityCount);
  if (!stateRaw) return out;

  const parsed = parseStateValue(stateRaw);
  out.visited = b64urlDecode(parsed.mask, Math.ceil(cityCount / 8));

  if (parsed.mode === "single") {
    for (const [idx, year] of decodeYearPairs(parsed.years)) {
      if (idx >= 0 && idx < cityCount) out.years.set(idx, year);
    }
  } else {
    if (!shardLoader) return out;
    for (let i = 0; i < parsed.shardCount; i++) {
      const v = shardLoader(i);
      if (!v) continue;
      for (const [idx, year] of decodeYearPairs(v)) {
        if (idx >= 0 && idx < cityCount) out.years.set(idx, year);
      }
    }
  }
  return out;
}
