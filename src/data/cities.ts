import generated from "./cities.generated.json";

export type City = {
  readonly idx: number;
  readonly rank: number;
  readonly name: string;
  readonly country: string | null;
  readonly slug: string;
  readonly lat: number | null;
  readonly lon: number | null;
};

// Source of truth for the city list. APPEND-ONLY: never reorder, never
// delete entries — the storage layer uses `idx` as the bit position in the
// visited bitmask. Renames are allowed.
export const CITIES: readonly City[] = Object.freeze(generated as City[]);

// Build-time invariant: catches accidental shrinkage of the list when
// regenerating the JSON. Bump LAST_KNOWN_LENGTH deliberately when adding
// new entries.
const LAST_KNOWN_LENGTH = 1230;
if (CITIES.length < LAST_KNOWN_LENGTH) {
  throw new Error(
    `CITIES shrank: ${CITIES.length} < ${LAST_KNOWN_LENGTH}. Append-only invariant violated.`,
  );
}

export const CITY_COUNT = CITIES.length;
