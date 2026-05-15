// One-shot utility: take a friend's list of visited cities (plain text,
// one per line, optionally `Name (Country)`), match against the current
// cities.generated.json, and print a share code in the lbdv1 format that
// can be pasted into the Mini App's "Сравнить" dialog.
//
// Usage:
//   node src/scripts/encode-friend.mjs <list.txt> [--name "Name"]
//
// The script also reports unmatched lines so we know which entries need
// to land in a future "custom places" store.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CITIES_PATH = join(__dirname, "..", "data", "cities.generated.json");

const args = process.argv.slice(2);
const listPath = args.find((a) => !a.startsWith("--"));
const nameIdx = args.indexOf("--name");
const friendName = nameIdx >= 0 ? args[nameIdx + 1] : null;

if (!listPath) {
  console.error("Usage: node encode-friend.mjs <list.txt> [--name \"Name\"]");
  process.exit(1);
}

const cities = JSON.parse(readFileSync(CITIES_PATH, "utf8"));

// Aliases for friend-list spellings that point at an existing canonical entry
// (avoids adding redundant cities just because of a spelling variant).
const NAME_ALIASES = {
  "ростов великий": "ростов",
  "переяславль-залесский": "переславль-залесский",
};

function normalize(s) {
  const lower = s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES[lower] ?? lower;
}

// Build name → candidates index. We deliberately do NOT strip hyphens or
// spaces so that "Ростов" doesn't collide with "Ростов-на-Дону".
const byName = new Map();
for (const c of cities) {
  const key = normalize(c.name);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(c);
}

function matchEntry(raw) {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const m = cleaned.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const name = m ? m[1].trim() : cleaned;
  const countryHint = m ? m[2].trim().toLowerCase() : null;

  const candidates = byName.get(normalize(name)) ?? [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1 && !countryHint) return candidates[0];

  // Disambiguate by country hint when there are several candidates.
  if (countryHint) {
    const matched = candidates.find((c) =>
      c.country && c.country.toLowerCase().includes(countryHint),
    );
    if (matched) return matched;
  }
  return candidates[0];
}

const rawLines = readFileSync(listPath, "utf8").split(/\r?\n/);
const matches = [];
const misses = [];
for (const line of rawLines) {
  const t = line.trim();
  if (!t) continue;
  const c = matchEntry(t);
  if (c) matches.push({ source: t, city: c });
  else misses.push(t);
}

// Build bitmask: ceil(CITY_COUNT/8) bytes, little-endian within byte.
const cityCount = cities.length;
const mask = new Uint8Array(Math.ceil(cityCount / 8));
const seen = new Set();
for (const { city } of matches) {
  if (seen.has(city.idx)) continue;
  seen.add(city.idx);
  mask[city.idx >> 3] |= 1 << (city.idx & 7);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function b64urlEncode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 0x3f];
  }
  return out;
}

const encName = friendName
  ? encodeURIComponent(friendName).replace(/\./g, "%2E")
  : "";
const code = `dom2v1.${encName}.${b64urlEncode(mask)}.`;

console.log(`Friend: ${friendName ?? "(unnamed)"}`);
console.log(`Matched: ${seen.size} / ${rawLines.filter((l) => l.trim()).length}`);
console.log(`Misses (${misses.length}): ${misses.join(", ") || "—"}`);
console.log("Share code:");
console.log(code);
