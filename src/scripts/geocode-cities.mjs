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
const FORCE = process.argv.includes("--force");

const cities = JSON.parse(readFileSync(CITIES_PATH, "utf8"));
const cache = existsSync(GEO_PATH) ? JSON.parse(readFileSync(GEO_PATH, "utf8")) : {};

const todo = cities.filter((c) => {
  if (FORCE) return true;
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

async function searchOnce(name, language) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "20");
  url.searchParams.set("language", language);
  url.searchParams.set("format", "json");
  try {
    const r = await fetch(url, { headers: { "user-agent": "dom2-places/0.1" } });
    if (!r.ok) return [];
    const data = await r.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}

function transliterationFromSlug(slug) {
  // Convert "sankt-peterburg" → "Sankt Peterburg".
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

async function geocodeOne(city) {
  // Open-Meteo's GeoNames index is multilingual but its population data is
  // populated unevenly per language. For many Russian cities a Cyrillic
  // query returns alphabetic-order junk (Мурманск → an Astrakhan village,
  // all results with population=null), while the same query in English
  // ("Murmansk") returns the real city with the right population. We query
  // both and merge before ranking.
  const englishish = transliterationFromSlug(city.slug);
  const [ruHits, enHits] = await Promise.all([
    searchOnce(city.name, "ru"),
    englishish.toLowerCase() !== city.name.toLowerCase()
      ? searchOnce(englishish, "en")
      : Promise.resolve([]),
  ]);

  // Merge and dedupe by 2-decimal coordinates (~1 km bucket).
  const seen = new Set();
  const all = [];
  for (const h of [...ruHits, ...enHits]) {
    if (typeof h.latitude !== "number" || typeof h.longitude !== "number") continue;
    const key = `${h.latitude.toFixed(2)},${h.longitude.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(h);
  }
  if (!all.length) return null;

  const want = city.country ? city.country.toLowerCase() : null;
  const inCountry = (h) =>
    want
      ? [h.country, h.country_code, h.admin1]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(want))
      : true;

  const candidates = want ? all.filter(inCountry) : all;
  const pool = candidates.length ? candidates : all;

  // Population descending, with a small bias toward administrative centres
  // when population is missing (PPLC > PPLA > PPLA2 > PPL).
  const featureWeight = {
    PPLC: 8, PPLA: 7, PPLA2: 5, PPLA3: 4, PPL: 3, PPLG: 3,
  };
  pool.sort((a, b) => {
    const pa = a.population ?? 0;
    const pb = b.population ?? 0;
    if (pa !== pb) return pb - pa;
    return (featureWeight[b.feature_code] ?? 0) - (featureWeight[a.feature_code] ?? 0);
  });
  const pick = pool[0];

  return {
    lat: +pick.latitude.toFixed(4),
    lon: +pick.longitude.toFixed(4),
    country: pick.country ?? null,
    population: pick.population ?? null,
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
