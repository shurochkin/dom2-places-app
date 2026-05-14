import { signal, computed, effect, batch } from "@preact/signals";
import { CITIES, CITY_COUNT, type City } from "../data/cities";
import {
  emptyState,
  isVisited,
  setVisited as setVisitedFlag,
  visitedCount,
  type State,
} from "./encoding";
import { createStorage, type StorageAdapter } from "./storage";

// We mutate the in-memory State directly for speed (Uint8Array, Map) and
// bump a revision counter so derived computeds re-run.
const rev = signal(0);
let state: State = emptyState(CITY_COUNT);

export const ready = signal(false);
export const inTelegramSignal = signal(false);
export const searchQuery = signal("");

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
  batch(() => {
    rev.value = rev.value + 1;
    ready.value = true;
  });
}

export function getCity(idx: number): City {
  return CITIES[idx]!;
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
