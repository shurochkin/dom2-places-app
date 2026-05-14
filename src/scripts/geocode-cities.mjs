// Geocodes every city in cities.generated.json via the free Open-Meteo
// geocoding API (no key, no rate limit for non-commercial use). Results are
// cached in cities.geo.json keyed by slug so the script can be re-run
// incrementally without re-querying matched cities.
//
// Usage: node src/scripts/geocode-cities.mjs [--retry-misses]
//
// The script is intentionally aggressive in parallelism (CONCURRENCY=16) since
// Open-Meteo handles bursts well; if you hit transient failures, just re-run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const CITIES_PATH = join(DATA_DIR, "cities.generated.json");
const GEO_PATH = join(DATA_DIR, "cities.geo.json");

const CONCURRENCY = 16;
const RETRY_MISSES = process.argv.includes("--retry-misses");

const cities = JSON.parse(readFileSync(CITIES_PATH, "utf8"));
const cache = existsSync(GEO_PATH) ? JSON.parse(readFileSync(GEO_PATH, "utf8")) : {};

const todo = cities.filter((c) => {
  if (!(c.slug in cache)) return true;
  if (RETRY_MISSES && cache[c.slug] === null) return true;
  return false;
});

console.log(
  `Geocoding ${todo.length} cities (already cached: ${cities.length - todo.length})`,
);

let saved = 0;
function persist() {
  writeFileSync(GEO_PATH, JSON.stringify(cache, null, 0));
  saved++;
}

async function geocodeOne(city) {
  // Open-Meteo takes a single search term; we use the Russian name first
  // (since that's what Lebedev published), then fall back to the country
  // hint if one was given to disambiguate homonyms.
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", city.name);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "ru");
  url.searchParams.set("format", "json");

  let r;
  try {
    r = await fetch(url, { headers: { "user-agent": "lebedev-places/0.1" } });
  } catch (e) {
    return { error: String(e) };
  }
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const data = await r.json();
  const hits = data.results ?? [];
  if (hits.length === 0) return null;

  // If the city has a country hint, prefer a result that matches it; this
  // disambiguates "Гранада" (ES vs NI), "Портленд" (US/UK), etc.
  let pick = hits[0];
  if (city.country) {
    const want = city.country.toLowerCase();
    const matched = hits.find((h) =>
      [h.country, h.country_code, h.admin1]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(want)),
    );
    if (matched) pick = matched;
  }
  return {
    lat: +pick.latitude.toFixed(4),
    lon: +pick.longitude.toFixed(4),
    country: pick.country ?? null,
  };
}

async function worker(queue) {
  while (queue.length) {
    const c = queue.shift();
    if (!c) return;
    try {
      const r = await geocodeOne(c);
      cache[c.slug] = r && "lat" in r ? r : null;
    } catch (e) {
      console.warn(`fail ${c.slug}:`, e);
      cache[c.slug] = null;
    }
    // Persist every ~50 results to survive Ctrl-C.
    if ((Object.keys(cache).length & 0x3f) === 0) persist();
  }
}

const queue = todo.slice();
const workers = Array.from({ length: CONCURRENCY }, () => worker(queue));
await Promise.all(workers);
persist();

const hit = Object.values(cache).filter((v) => v && "lat" in v).length;
const miss = Object.values(cache).filter((v) => v === null).length;
console.log(`Done. Matched: ${hit} / ${cities.length}. Misses: ${miss}.`);
console.log(`Wrote ${GEO_PATH} (saved ${saved} times)`);
