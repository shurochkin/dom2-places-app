// Parses src/data/cities.raw.txt into src/data/cities.generated.json.
// Strips soft hyphens (U+00AD) and trailing punctuation, extracts optional
// country in parentheses, assigns stable index ids, and disambiguates slugs
// for duplicate display names (e.g. "Гранада", "Портленд", "Сен-Пьер").

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_PATH = join(__dirname, "..", "data", "cities.raw.txt");
const GEO_PATH = join(__dirname, "..", "data", "cities.geo.json");
const OVERRIDES_PATH = join(__dirname, "..", "data", "cities.geo.overrides.json");
const OUT_PATH = join(__dirname, "..", "data", "cities.generated.json");

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

function slugify(s) {
  let out = "";
  for (const ch of s.toLowerCase()) {
    if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (ch === " " || ch === "-" || ch === "'") out += "-";
  }
  return out.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function main() {
  const raw = readFileSync(RAW_PATH, "utf8");
  const cleaned = raw
    .replace(/­/g, "") // soft hyphens
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");

  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);

  const cities = parts.map((entry, idx) => {
    const m = entry.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const name = (m ? m[1] : entry).trim();
    const country = m ? m[2].trim() : null;
    return { idx, rank: idx + 1, name, country, slug: slugify(name), lat: null, lon: null };
  });

  // Disambiguate slugs for repeated names.
  const counts = new Map();
  for (const c of cities) counts.set(c.slug, (counts.get(c.slug) ?? 0) + 1);

  const seen = new Map();
  for (const c of cities) {
    if ((counts.get(c.slug) ?? 0) > 1) {
      const n = (seen.get(c.slug) ?? 0) + 1;
      seen.set(c.slug, n);
      const suffix = c.country ? slugify(c.country) : `n${n}`;
      c.slug = `${c.slug}-${suffix || `n${n}`}`;
    }
  }

  // Final uniqueness check.
  const allSlugs = new Set();
  for (const c of cities) {
    if (allSlugs.has(c.slug)) {
      throw new Error(`Duplicate slug after disambiguation: ${c.slug} (${c.name})`);
    }
    allSlugs.add(c.slug);
  }

  // Merge geocoded coordinates if cached.
  let withGeo = 0;
  if (existsSync(GEO_PATH)) {
    const geo = JSON.parse(readFileSync(GEO_PATH, "utf8"));
    for (const c of cities) {
      const g = geo[c.slug];
      if (g && typeof g.lat === "number" && typeof g.lon === "number") {
        c.lat = g.lat;
        c.lon = g.lon;
        withGeo++;
      }
    }
  }

  // Hand-curated overrides win over geocoder output. Used for historical
  // renamings the public geocoders don't resolve (Бомбей → Mumbai, etc).
  let overridden = 0;
  if (existsSync(OVERRIDES_PATH)) {
    const overrides = JSON.parse(readFileSync(OVERRIDES_PATH, "utf8"));
    for (const c of cities) {
      const o = overrides[c.slug];
      if (o && typeof o.lat === "number" && typeof o.lon === "number") {
        if (c.lat === null) withGeo++;
        c.lat = o.lat;
        c.lon = o.lon;
        overridden++;
      }
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify(cities, null, 0) + "\n");
  console.log(
    `Wrote ${cities.length} cities to ${OUT_PATH} (${withGeo} with coordinates, ${overridden} hand-overridden)`,
  );
}

main();
