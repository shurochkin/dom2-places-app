import { useEffect, useRef } from "preact/hooks";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CITIES } from "../data/cities";
import {
  compareState,
  isCityVisited,
  isFriendVisited,
  toggleCity,
} from "../lib/store";

type Bucket = "both" | "mine" | "friend" | "none";

function bucketFor(idx: number, inCompare: boolean): Bucket {
  const mine = isCityVisited(idx);
  if (!inCompare) return mine ? "mine" : "none";
  const friend = isFriendVisited(idx);
  if (mine && friend) return "both";
  if (mine) return "mine";
  if (friend) return "friend";
  return "none";
}

function styleFor(bucket: Bucket): L.CircleMarkerOptions {
  switch (bucket) {
    case "mine":
      return { radius: 6, color: "#fff", weight: 1, fillColor: "#2481cc", fillOpacity: 0.95 };
    case "friend":
      return { radius: 6, color: "#fff", weight: 1, fillColor: "#f59e0b", fillOpacity: 0.95 };
    case "both":
      return { radius: 7, color: "#fff", weight: 1.5, fillColor: "#8b5cf6", fillOpacity: 1 };
    case "none":
    default:
      return { radius: 2.5, color: "transparent", weight: 0, fillColor: "#9aa4ad", fillOpacity: 0.55 };
  }
}

type TileSpec = {
  url: string;
  attribution: string;
  subdomains: string;
  maxZoom: number;
};

// Stadia Maps tile authentication. The api_key is baked into the bundle at
// build time from PUBLIC_STADIA_API_KEY — it ends up in the public JS, which
// is fine: Stadia keys are designed as client-side identifiers, and abuse
// protection is done by configuring Authorized Domains on the key in the
// Stadia dashboard.
const STADIA_API_KEY = import.meta.env.PUBLIC_STADIA_API_KEY ?? "";
const STADIA_ATTRIBUTION =
  '© <a href="https://www.stadiamaps.com/">Stadia Maps</a> · ' +
  '© <a href="https://openmaptiles.org/">OpenMapTiles</a> · ' +
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function tilesForTheme(): TileSpec {
  const dark = document.documentElement.dataset.theme === "dark";
  const style = dark ? "alidade_smooth_dark" : "alidade_smooth";
  const suffix = STADIA_API_KEY ? `?api_key=${STADIA_API_KEY}` : "";
  return {
    url: `https://tiles.stadiamaps.com/tiles/${style}/{z}/{x}/{y}{r}.png${suffix}`,
    attribution: STADIA_ATTRIBUTION,
    subdomains: "abc",
    maxZoom: 20,
  };
}

function applyTiles(map: L.Map, current: L.TileLayer | null, spec: TileSpec) {
  if (current) current.remove();
  return L.tileLayer(spec.url, {
    attribution: spec.attribution,
    maxZoom: spec.maxZoom,
    subdomains: spec.subdomains,
  }).addTo(map);
}

type Props = {
  active: boolean; // when true, invalidateSize on next paint (tab just opened)
};

export function MapView({ active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Array<L.CircleMarker | null>>([]);

  const inCompare = compareState.value !== null;
  // Subscribe to the global revision counter via these reads so the component
  // re-renders when any city toggle happens — the second useEffect then
  // repaints all markers.
  if (CITIES.length > 0) isCityVisited(0);

  // Mount once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView([30, 15], 2);
    mapRef.current = map;
    tileRef.current = applyTiles(map, null, tilesForTheme());

    // Swap tile layers when Telegram flips its theme at runtime.
    const themeObserver = new MutationObserver(() => {
      if (!mapRef.current) return;
      tileRef.current = applyTiles(mapRef.current, tileRef.current, tilesForTheme());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const markers: Array<L.CircleMarker | null> = new Array(CITIES.length).fill(null);
    for (let i = 0; i < CITIES.length; i++) {
      const c = CITIES[i]!;
      if (c.lat == null || c.lon == null) continue;
      const marker = L.circleMarker([c.lat, c.lon], styleFor(bucketFor(i, false)));
      marker.bindTooltip(
        c.country ? `<strong>${c.name}</strong> · ${c.country}` : `<strong>${c.name}</strong>`,
        { direction: "top", offset: [0, -4], sticky: true },
      );
      marker.on("click", () => toggleCity(i));
      marker.addTo(map);
      markers[i] = marker;
    }
    markersRef.current = markers;

    return () => {
      themeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      markersRef.current = [];
    };
  }, []);

  // Repaint markers on every render (cheap setStyle), so toggling a city in
  // the list view immediately reflects on the map and vice versa.
  useEffect(() => {
    for (let i = 0; i < markersRef.current.length; i++) {
      const m = markersRef.current[i];
      if (!m) continue;
      m.setStyle(styleFor(bucketFor(i, inCompare)));
    }
  });

  // When the tab becomes active, Leaflet may have measured a 0-height
  // container — kick it to recalculate.
  useEffect(() => {
    if (!active || !mapRef.current) return;
    const id = requestAnimationFrame(() => mapRef.current?.invalidateSize());
    return () => cancelAnimationFrame(id);
  }, [active]);

  return <div ref={containerRef} class="mapview" />;
}
