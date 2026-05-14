import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

const SITE = process.env.SITE ?? "https://example.github.io";
const BASE = process.env.BASE ?? "/lebedev-places/";

export default defineConfig({
  site: SITE,
  base: BASE,
  output: "static",
  trailingSlash: "ignore",
  integrations: [preact({ compat: false })],
  vite: {
    build: { target: "es2020" },
  },
});
