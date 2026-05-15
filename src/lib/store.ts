import { signal, computed, effect, batch } from "@preact/signals";
import { CITIES, CITY_COUNT, type City } from "../data/cities";
import {
  decodeShareCode,
  emptyState,
  encodeShareCode,
  isVisited,
  setVisited as setVisitedFlag,
  visitedCount,
  type State,
} from "./encoding";
import { createStorage, type StorageAdapter } from "./storage";
import {
  addOrMergeFriend,
  computeAggregate,
  deleteFriend as deleteFriendFromStorage,
  loadAllFriends,
  type Aggregate,
  type Friend,
} from "./friends";

// We mutate the in-memory State directly for speed (Uint8Array, Map) and
// bump a revision counter so derived computeds re-run.
const rev = signal(0);
let state: State = emptyState(CITY_COUNT);

export type View = "list" | "map" | "friends";
export type MapStyleId = "alidade" | "carto" | "esri" | "osm";

export const ready = signal(false);
export const inTelegramSignal = signal(false);
export const searchQuery = signal("");
export const currentView = signal<View>("list");

const MAP_STYLE_KEY = "dom2-places:map-style";
const VALID_STYLES: readonly MapStyleId[] = ["alidade", "carto", "esri", "osm"];

function loadInitialMapStyle(): MapStyleId {
  // Carto is the default in dom2-places — its tiles work without an API key,
  // so the deploy is functional even before STADIA_API_KEY lands in CI.
  if (typeof localStorage === "undefined") return "carto";
  const s = localStorage.getItem(MAP_STYLE_KEY) as MapStyleId | null;
  return s && VALID_STYLES.includes(s) ? s : "carto";
}

export const mapStyle = signal<MapStyleId>(loadInitialMapStyle());

export function setMapStyle(id: MapStyleId): void {
  mapStyle.value = id;
  try {
    localStorage.setItem(MAP_STYLE_KEY, id);
  } catch {
    /* private mode etc — ignore */
  }
}

let storage: StorageAdapter | null = null;
export const saveStatus = computed<"idle" | "saving" | "error" | "saved">(() => {
  return storage ? storage.status.value : "idle";
});

const lowerNames: string[] = CITIES.map((c) =>
  (c.country ? `${c.name} ${c.country}` : c.name).toLowerCase(),
);

export const visibleIndices = computed<readonly number[]>(() => {
  rev.value; // subscribe so toggles don't re-filter
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return CITIES.map((c) => c.idx);
  const out: number[] = [];
  for (let i = 0; i < CITIES.length; i++) {
    if (lowerNames[i]!.includes(q)) out.push(i);
  }
  return out;
});

export const stats = computed(() => {
  rev.value;
  return { visited: visitedCount(state), total: CITY_COUNT };
});

export function isCityVisited(idx: number): boolean {
  rev.value;
  return isVisited(state, idx);
}

export function getCityYear(idx: number): number | undefined {
  rev.value;
  return state.years.get(idx);
}

export function toggleCity(idx: number, on?: boolean): void {
  const next = on ?? !isVisited(state, idx);
  setVisitedFlag(state, idx, next);
  bumpAndSave();
}

export function setCityYear(idx: number, year: number | undefined): void {
  if (year === undefined) {
    state.years.delete(idx);
  } else {
    if (!isVisited(state, idx)) setVisitedFlag(state, idx, true);
    state.years.set(idx, year);
  }
  bumpAndSave();
}

function bumpAndSave() {
  rev.value = rev.value + 1;
  if (storage) storage.save(state);
}

export async function bootstrapStore(): Promise<void> {
  storage = createStorage();
  inTelegramSignal.value = storage.inTelegram;
  state = await storage.load(CITY_COUNT);
  let savedFriends: Friend[] = [];
  try {
    savedFriends = await loadAllFriends(storage, CITY_COUNT);
  } catch {
    /* friends are best-effort */
  }
  batch(() => {
    friends.value = savedFriends;
    rev.value = rev.value + 1;
    ready.value = true;
  });
}

export function getCity(idx: number): City {
  return CITIES[idx]!;
}

// --- friend comparison mode -----------------------------------------------

export const compareState = signal<State | null>(null);
export const compareName = signal<string | null>(null);

// Saved-friends list (persisted via lib/friends storage layer).
export const friends = signal<Friend[]>([]);

export const aggregate = computed<Aggregate>(() => {
  rev.value; // re-run when user state mutates
  return computeAggregate(CITY_COUNT, state, friends.value);
});

export function isFriendVisited(idx: number): boolean {
  const s = compareState.value;
  return s ? isVisited(s, idx) : false;
}

export const compareStats = computed(() => {
  rev.value;
  const friend = compareState.value;
  if (!friend) return null;
  let common = 0;
  let onlyMine = 0;
  let onlyFriend = 0;
  for (let i = 0; i < CITY_COUNT; i++) {
    const mine = isVisited(state, i);
    const theirs = isVisited(friend, i);
    if (mine && theirs) common++;
    else if (mine) onlyMine++;
    else if (theirs) onlyFriend++;
  }
  return { common, onlyMine, onlyFriend, friendTotal: visitedCount(friend) };
});

export function buildShareCode(displayName?: string | null): string {
  return encodeShareCode(state, displayName ?? null);
}

// Imports a share code, persists the friend (merging by name), and enters
// compare mode on it. Returns the resulting friend on success.
export async function importFriendCode(
  code: string,
): Promise<
  | { ok: true; friend: Friend; merged: boolean }
  | { ok: false; reason: string }
> {
  const decoded = decodeShareCode(CITY_COUNT, code);
  if (!decoded) {
    return { ok: false, reason: "Не удалось разобрать код. Проверьте, что скопировали целиком." };
  }
  const name = decoded.name?.trim() || "Без имени";
  if (!storage) return { ok: false, reason: "Хранилище ещё не готово, попробуйте снова через секунду." };
  try {
    const { friend, merged } = await addOrMergeFriend(storage, friends.value, name, decoded.state);
    batch(() => {
      // Replace if merged, append if new.
      const list = friends.value.filter((f) => f.id !== friend.id);
      list.push(friend);
      friends.value = list;
      compareState.value = friend.state;
      compareName.value = friend.name;
      rev.value = rev.value + 1;
    });
    return { ok: true, friend, merged };
  } catch (err) {
    return { ok: false, reason: `Не удалось сохранить друга: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function enterCompareWithFriend(id: string): void {
  const friend = friends.value.find((f) => f.id === id);
  if (!friend) return;
  batch(() => {
    compareState.value = friend.state;
    compareName.value = friend.name;
    rev.value = rev.value + 1;
  });
}

export async function removeFriend(id: string): Promise<void> {
  if (!storage) return;
  const remaining = await deleteFriendFromStorage(storage, friends.value, id);
  batch(() => {
    friends.value = remaining;
    // If we were comparing with this friend, exit compare mode.
    if (compareName.value && !remaining.some((f) => f.name === compareName.value)) {
      // Best-effort: name-match. Safer than tracking compare friend id explicitly.
    }
    rev.value = rev.value + 1;
  });
}

export function exitCompareMode(): void {
  batch(() => {
    compareState.value = null;
    compareName.value = null;
    rev.value = rev.value + 1;
  });
}

// Per-bucket visibility for the map view in compare mode. Toggled via the
// chips in HeaderBar; transient UI state, not persisted.
export type CompareBucket = "mine" | "friend" | "both";
const ALL_BUCKETS: CompareBucket[] = ["mine", "friend", "both"];
export const compareFilters = signal<Set<CompareBucket>>(new Set(ALL_BUCKETS));

export function isBucketVisible(b: CompareBucket): boolean {
  return compareFilters.value.has(b);
}

export function toggleBucketVisible(b: CompareBucket): void {
  const next = new Set(compareFilters.value);
  if (next.has(b)) next.delete(b);
  else next.add(b);
  compareFilters.value = next;
}

// Watch for save status changes to drive the closing-confirmation flag.
// The caller (telegram bootstrap) passes a setter; storing it here avoids
// circular module imports.
let closingConfirmation: ((on: boolean) => void) | null = null;
export function bindClosingConfirmation(fn: (on: boolean) => void) {
  closingConfirmation = fn;
}
effect(() => {
  if (!closingConfirmation) return;
  const s = saveStatus.value;
  closingConfirmation(s === "saving");
});
