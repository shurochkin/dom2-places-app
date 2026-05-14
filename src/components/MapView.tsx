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

function tileUrlForTheme(): { url: string; attribution: string } {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") {
    return {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/">Carto</a>',
    };
  }
  return {
    url: "https://{s}.basemaps.cartocdn.com/voyager/{z}/{x}/{y}{r}.png",
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/">Carto</a>',
  };
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
    const tt = tileUrlForTheme();
    const tile = L.tileLayer(tt.url, {
      attribution: tt.attribution,
      maxZoom: 18,
      subdomains: "abcd",
    }).addTo(map);
    mapRef.current = map;
    tileRef.current = tile;

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

    // Re-pick tiles if the Telegram theme flips dark/light at runtime.
    const themeObserver = new MutationObserver(() => {
      if (!tileRef.current || !mapRef.current) return;
      tileRef.current.remove();
      const next = tileUrlForTheme();
      tileRef.current = L.tileLayer(next.url, {
        attribution: next.attribution,
        maxZoom: 18,
        subdomains: "abcd",
      }).addTo(mapRef.current);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

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
