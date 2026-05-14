# Cities data

Source of truth: `cities.raw.txt` — Artemy Lebedev's published "interestingness"
ranking, one comma-separated line. Soft hyphens (U+00AD) and a few stylistic
artefacts from the original copy-paste have been removed.

`build-cities.mjs` parses the raw file into `cities.generated.json` (an ordered
array of `{idx, rank, name, country, slug}`). `cities.ts` imports the JSON,
freezes it, and asserts the append-only invariant.

## Rules

1. **Append-only.** New cities go to the end of `cities.raw.txt`. The `idx`
   field is the bit position in the persisted visited-bitmask — moving or
   removing entries invalidates every user's saved state.
2. **Renames are fine.** The `idx` does not depend on the name.
3. **Duplicate display names** are disambiguated by appending the slugified
   country (or a numeric suffix when no country is given) to the slug. The
   visible label always renders `name, country` for clarity.
4. **Bump `LAST_KNOWN_LENGTH`** in `cities.ts` after appending new rows —
   this is the build-time guard against accidental shrinkage.

## Regenerating

```bash
npm run build:cities
```

This runs as part of `npm run build` as well.
