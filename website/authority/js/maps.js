/**
 * Leaflet helpers: theme-aware base map, numbered/vehicle markers, click-to-pick map.
 * Leaflet is loaded globally (L) from the CDN in index.html.
 */
import { h } from './ui.js';

// OpenStreetMap standard tiles; dark mode is a CSS filter on .leaflet-tile-pane (see style.css).
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const DEFAULT_CENTER = [22.82, 89.55]; // Khulna; maps normally fit their data instead

/** Create a map in `el`. Tiles follow the app theme through CSS, nothing to re-create on toggle. */
export function createMap(el, { center = DEFAULT_CENTER, zoom = 12 } = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
  // Drawers and tabs size their content after paint — re-measure once things settle.
  setTimeout(() => map.invalidateSize(), 120);
  setTimeout(() => map.invalidateSize(), 400);
  return map;
}

/** Tooltip content as a text node: Leaflet writes string content with innerHTML, and names are user-entered. */
export const tip = (text) => { const s = document.createElement('span'); s.textContent = text; return s; };

export function numberedMarker(latlng, n, cls = 'idle') {
  return L.marker(latlng, { icon: L.divIcon({ className: '', html: `<div class="fs-marker ${cls}">${n}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) });
}

/** Vehicle marker: green when live, grey when stale, amber in maintenance; arrow-free for readability. */
export function vehicleMarker(latlng, { label, status, stale, live }) {
  const cls = stale ? 'stale' : status === 'maintenance' ? 'maintenance' : status === 'on_trip' ? 'live' : 'idle';
  return L.marker(latlng, { icon: L.divIcon({ className: '', html: `<div class="fs-marker ${cls}${live ? ' live' : ''}">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) });
}

export function fitTo(map, latlngs, { maxZoom = 15, padding = 40 } = {}) {
  const pts = latlngs.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return;
  if (pts.length === 1) map.setView(pts[0], maxZoom);
  else map.fitBounds(L.latLngBounds(pts), { padding: [padding, padding], maxZoom });
}

/** A small map where clicking sets a position. onPick(lat, lng); returns { el, setPosition(lat,lng), map }. */
export function pickerMap({ lat, lng, onPick }) {
  const el = h('div', { class: 'map-box short', style: { marginBottom: '16px' } });
  let marker = null;
  const map = createMap(el, { center: Number.isFinite(lat) ? [lat, lng] : DEFAULT_CENTER, zoom: Number.isFinite(lat) ? 14 : 11 });
  const place = (la, lo) => {
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    if (marker) marker.setLatLng([la, lo]); else marker = numberedMarker([la, lo], '•').addTo(map);
  };
  place(lat, lng);
  map.on('click', (e) => { place(e.latlng.lat, e.latlng.lng); onPick(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)); });
  return { el, map, setPosition: (la, lo) => { place(la, lo); if (Number.isFinite(la)) map.panTo([la, lo]); } };
}
