import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

const SITE = process.env.SITE ?? "https://shurochkin.github.io";
const BASE = process.env.BASE ?? "/dom2-places-app/";

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
