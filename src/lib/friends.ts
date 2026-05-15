import {
  emptyState,
  isVisited,
  pack,
  parseStateValue,
  unpack,
  visitedCount,
  type State,
} from "./encoding";
import type { StorageAdapter } from "./storage";

// CloudStorage layout for saved friends:
//   v1_fr_index — JSON array of FriendMeta (id, name, addedAt)
//   v1_fr_<id>_state — pack()'d state value (same format as the user's own
//                     state — base64url mask + year csv or @C:N header)
//   v1_fr_<id>_y_<N> — year-pair shards when state overflows the single key
//
// At Telegram's 1024-key cap this lets us hold roughly 200 friends, plenty
// for personal use.

const INDEX_KEY = "v1_fr_index";
const FRIEND_PREFIX = "v1_fr_";
const FRIEND_STATE_SUFFIX = "_state";
const FRIEND_SHARD_SUFFIX = "_y_";

export type FriendMeta = {
  id: string;
  name: string;
  addedAt: number;
};

export type Friend = FriendMeta & {
  state: State;
};

function stateKey(id: string): string {
  return FRIEND_PREFIX + id + FRIEND_STATE_SUFFIX;
}
function shardKey(id: string, n: number): string {
  return FRIEND_PREFIX + id + FRIEND_SHARD_SUFFIX + n;
}

function newId(addedAt: number): string {
  return addedAt.toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function loadIndex(storage: StorageAdapter): Promise<FriendMeta[]> {
  try {
    const raw = await storage.getRaw(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filter — drop malformed entries instead of throwing.
    return parsed.filter(
      (m): m is FriendMeta =>
        m && typeof m.id === "string" && typeof m.addedAt === "number",
    );
  } catch {
    return [];
  }
}

async function saveIndex(storage: StorageAdapter, index: FriendMeta[]): Promise<void> {
  await storage.setRaw(INDEX_KEY, JSON.stringify(index));
}

async function loadFriendState(
  storage: StorageAdapter,
  id: string,
  cityCount: number,
): Promise<State> {
  const stateRaw = await storage.getRaw(stateKey(id));
  if (!stateRaw) return emptyState(cityCount);
  const parsed = parseStateValue(stateRaw);
  if (parsed.mode !== "sharded" || parsed.shardCount === 0) {
    return unpack(cityCount, stateRaw);
  }
  const keys = Array.from({ length: parsed.shardCount }, (_, i) => shardKey(id, i));
  const values = await storage.getMany(keys);
  return unpack(cityCount, stateRaw, (i) => values[shardKey(id, i)]);
}

export async function loadAllFriends(
  storage: StorageAdapter,
  cityCount: number,
): Promise<Friend[]> {
  const index = await loadIndex(storage);
  const out: Friend[] = [];
  for (const meta of index) {
    const state = await loadFriendState(storage, meta.id, cityCount);
    out.push({ ...meta, state });
  }
  return out;
}

async function writeFriendState(
  storage: StorageAdapter,
  id: string,
  state: State,
): Promise<void> {
  const packed = pack(state);
  await storage.setRaw(stateKey(id), packed.state);
  for (let i = 0; i < packed.shards.length; i++) {
    await storage.setRaw(shardKey(id, i), packed.shards[i]!);
  }
  // Tolerate leftover shards from a previous larger save — try removing the
  // next few slots so they don't linger.
  const stale = [shardKey(id, packed.shards.length), shardKey(id, packed.shards.length + 1)];
  await storage.removeMany(stale);
}

export type AddFriendResult = { friend: Friend; merged: boolean };

// Adds a friend or merges into an existing one with the same normalised name.
// Returns the resulting Friend and whether an existing entry was overwritten.
export async function addOrMergeFriend(
  storage: StorageAdapter,
  current: Friend[],
  name: string,
  state: State,
): Promise<AddFriendResult> {
  const norm = normName(name);
  const now = Date.now();
  const existing = norm ? current.find((f) => normName(f.name) === norm) : null;

  if (existing) {
    const merged: Friend = { ...existing, state, addedAt: now };
    await writeFriendState(storage, merged.id, merged.state);
    const index = current.map((f) =>
      f.id === merged.id ? { id: merged.id, name: merged.name, addedAt: merged.addedAt } : { id: f.id, name: f.name, addedAt: f.addedAt },
    );
    await saveIndex(storage, index);
    return { friend: merged, merged: true };
  }

  const id = newId(now);
  const friend: Friend = { id, name: name.trim(), addedAt: now, state };
  await writeFriendState(storage, id, state);
  const index = [...current, { id, name: friend.name, addedAt: now }].map((f) => ({
    id: f.id,
    name: f.name,
    addedAt: f.addedAt,
  }));
  await saveIndex(storage, index);
  return { friend, merged: false };
}

export async function deleteFriend(
  storage: StorageAdapter,
  current: Friend[],
  id: string,
): Promise<Friend[]> {
  const remaining = current.filter((f) => f.id !== id);
  const index = remaining.map((f) => ({ id: f.id, name: f.name, addedAt: f.addedAt }));
  await saveIndex(storage, index);
  // Remove state + a generous number of shard slots in case any are lingering.
  const keys = [stateKey(id)];
  for (let i = 0; i < 4; i++) keys.push(shardKey(id, i));
  await storage.removeMany(keys);
  return remaining;
}

// --- aggregate bitmask helpers ---

export type Aggregate = {
  /** Total cities. */
  total: number;
  /** My own visited count. */
  mine: number;
  /** Cities visited by user + every friend. */
  intersection: number;
  /** Cities visited by user but no friend. */
  onlyMine: number;
  /** Cities visited by at least one friend but not me. */
  onlyFriends: number;
  /** Cities visited by me OR at least one friend. */
  union: number;
  /** Cities visited by nobody (me and friends). */
  nobody: number;
};

export function computeAggregate(
  cityCount: number,
  mine: State,
  friends: Friend[],
): Aggregate {
  const bytes = mine.visited.length;
  if (friends.length === 0) {
    const mineCount = visitedCount(mine);
    return {
      total: cityCount,
      mine: mineCount,
      intersection: mineCount,
      onlyMine: mineCount,
      onlyFriends: 0,
      union: mineCount,
      nobody: cityCount - mineCount,
    };
  }

  const friendUnion = new Uint8Array(bytes);
  const friendInter = new Uint8Array(bytes).fill(0xff);
  for (const f of friends) {
    for (let i = 0; i < bytes; i++) {
      friendUnion[i]! |= f.state.visited[i]!;
      friendInter[i]! &= f.state.visited[i]!;
    }
  }

  let mineCnt = 0;
  let interCnt = 0;
  let onlyMineCnt = 0;
  let onlyFriendsCnt = 0;
  let unionCnt = 0;

  for (let i = 0; i < bytes; i++) {
    const m = mine.visited[i]!;
    const fu = friendUnion[i]!;
    const fi = friendInter[i]!;
    mineCnt += popcount(m);
    interCnt += popcount(m & fi);
    onlyMineCnt += popcount(m & ~fu);
    onlyFriendsCnt += popcount(fu & ~m);
    unionCnt += popcount(m | fu);
  }
  // Mask out bits past cityCount (overflow within the last byte).
  const validBits = cityCount;
  const usedBits = bytes * 8;
  const overflow = usedBits - validBits;
  if (overflow > 0) {
    // Recount the last byte with the overflow mask if any of its bits were set.
    const lastByteIdx = bytes - 1;
    const lastByteMask = 0xff >> overflow;
    const m = mine.visited[lastByteIdx]! & ~lastByteMask;
    const fu = friendUnion[lastByteIdx]! & ~lastByteMask;
    const fi = friendInter[lastByteIdx]! & ~lastByteMask;
    if (m | fu | fi) {
      mineCnt -= popcount(m);
      interCnt -= popcount(m & fi);
      onlyMineCnt -= popcount(m & ~fu);
      onlyFriendsCnt -= popcount(fu & ~m);
      unionCnt -= popcount(m | fu);
    }
  }

  return {
    total: cityCount,
    mine: mineCnt,
    intersection: interCnt,
    onlyMine: onlyMineCnt,
    onlyFriends: onlyFriendsCnt,
    union: unionCnt,
    nobody: cityCount - unionCnt,
  };
}

function popcount(b: number): number {
  let n = 0;
  let v = b & 0xff;
  while (v) {
    v &= v - 1;
    n++;
  }
  return n;
}

// Helper for UI: how many cities a single friend has visited (cached via
// the state we already loaded).
export function friendVisitedCount(friend: Friend): number {
  return visitedCount(friend.state);
}

export function isFriendCityVisited(friend: Friend, idx: number): boolean {
  return isVisited(friend.state, idx);
}
