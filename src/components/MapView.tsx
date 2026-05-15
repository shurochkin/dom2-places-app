import { useEffect, useRef } from "preact/hooks";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CITIES } from "../data/cities";
import {
  compareState,
  isCityVisited,
  isFriendVisited,
  mapStyle,
  setMapStyle,
  toggleCity,
  type MapStyleId,
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

// Read the palette from CSS custom properties so the map markers, the
// header chips and the row badges stay in lockstep. Cached after first
// resolution since the values don't change at runtime.
let pinColors: Record<Bucket, string> | null = null;
function getPin(bucket: Bucket): string {
  if (!pinColors) {
    const cs = getComputedStyle(document.documentElement);
    pinColors = {
      mine: cs.getPropertyValue("--pin-mine").trim() || "#2481cc",
      friend: cs.getPropertyValue("--pin-friend").trim() || "#f59e0b",
      both: cs.getPropertyValue("--pin-both").trim() || "#8b5cf6",
      none: cs.getPropertyValue("--pin-none").trim() || "#9aa4ad",
    };
  }
  return pinColors[bucket];
}

function styleFor(bucket: Bucket): L.CircleMarkerOptions {
  switch (bucket) {
    case "mine":
      return { radius: 6, color: "#fff", weight: 1, fillColor: getPin("mine"), fillOpacity: 0.95 };
    case "friend":
      return { radius: 6, color: "#fff", weight: 1, fillColor: getPin("friend"), fillOpacity: 0.95 };
    case "both":
      return { radius: 7, color: "#fff", weight: 1.5, fillColor: getPin("both"), fillOpacity: 1 };
    case "none":
    default:
      return { radius: 2.5, color: "transparent", weight: 0, fillColor: getPin("none"), fillOpacity: 0.55 };
  }
}

type TileSpec = {
  url: string;
  attribution: string;
  subdomains: string;
  maxZoom: number;
};

// Stadia API key is baked in at build from PUBLIC_STADIA_API_KEY. Stadia keys
// are designed for client-side use; abuse protection comes from configuring
// Authorized Domains on the key in the Stadia dashboard.
const STADIA_API_KEY = import.meta.env.PUBLIC_STADIA_API_KEY ?? "";

type StyleDef = {
  id: MapStyleId;
  label: string;
  buildSpec: (dark: boolean) => TileSpec;
};

const STYLES: readonly StyleDef[] = [
  {
    id: "alidade",
    label: "Alidade",
    buildSpec: (dark) => {
      const style = dark ? "alidade_smooth_dark" : "alidade_smooth";
      const suffix = STADIA_API_KEY ? `?api_key=${STADIA_API_KEY}` : "";
      return {
        url: `https://tiles.stadiamaps.com/tiles/${style}/{z}/{x}/{y}{r}.png${suffix}`,
        attribution:
          '© <a href="https://www.stadiamaps.com/">Stadia Maps</a> · ' +
          '© <a href="https://openmaptiles.org/">OpenMapTiles</a> · ' +
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        subdomains: "abc",
        maxZoom: 20,
      };
    },
  },
  {
    id: "carto",
    label: "Carto",
    buildSpec: (dark) => ({
      url: dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/voyager/{z}/{x}/{y}{r}.png",
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ' +
        '© <a href="https://carto.com/">Carto</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }),
  },
  {
    id: "esri",
    label: "Esri Gray",
    buildSpec: (dark) => ({
      url: dark
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      attribution:
        'Tiles © <a href="https://www.esri.com/">Esri</a> — ' +
        'sources: Esri, HERE, Garmin, FAO, NOAA, USGS',
      subdomains: "",
      maxZoom: 16,
    }),
  },
  {
    id: "osm",
    label: "OSM",
    buildSpec: () => ({
      // OSM has no official dark style — same tiles in both themes.
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: "abc",
      maxZoom: 19,
    }),
  },
];

function specFor(id: MapStyleId, dark: boolean): TileSpec {
  const def = STYLES.find((s) => s.id === id) ?? STYLES[0]!;
  return def.buildSpec(dark);
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
  const styleId = mapStyle.value;
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
    const isDark = () => document.documentElement.dataset.theme === "dark";
    tileRef.current = applyTiles(map, null, specFor(mapStyle.value, isDark()));

    // Swap tile layers when Telegram flips its theme at runtime.
    const themeObserver = new MutationObserver(() => {
      if (!mapRef.current) return;
      tileRef.current = applyTiles(
        mapRef.current,
        tileRef.current,
        specFor(mapStyle.value, isDark()),
      );
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

  // Swap the tile layer when the user picks a different basemap style.
  useEffect(() => {
    if (!mapRef.current) return;
    const isDark = document.documentElement.dataset.theme === "dark";
    tileRef.current = applyTiles(mapRef.current, tileRef.current, specFor(styleId, isDark));
  }, [styleId]);

  // When the tab becomes active, Leaflet may have measured a 0-height
  // container — kick it to recalculate.
  useEffect(() => {
    if (!active || !mapRef.current) return;
    const id = requestAnimationFrame(() => mapRef.current?.invalidateSize());
    return () => cancelAnimationFrame(id);
  }, [active]);

  return (
    <>
      <div ref={containerRef} class="mapview" />
      <div class="map-style-picker" role="radiogroup" aria-label="Стиль карты">
        {STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            class="map-style-picker__btn"
            data-active={styleId === s.id ? "1" : "0"}
            role="radio"
            aria-checked={styleId === s.id}
            onClick={() => setMapStyle(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}
