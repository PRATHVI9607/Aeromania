// Lat/lon parsing, AOI lookup, UTM projection.
export interface LL { lat: number; lon: number }

/** "13.10, 77.51" | "13.10 77.51" | "13.10N 77.51E" | "13.1S, 77.5W" */
export function parseLatLon(s: string): LL | null {
  const m = s.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = +m[1], lon = +m[3];
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export const km = (a: LL, b: LL) => {
  const r = Math.PI / 180, dy = (a.lat - b.lat) * 111.19, dx = (a.lon - b.lon) * 111.19 * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(dx, dy);
};

export function nearest<T extends LL>(xs: T[], p: LL, maxKm = Infinity): { x: T; km: number } | null {
  let best: T | null = null, bd = maxKm;
  for (const x of xs) { const d = km(x, p); if (d <= bd) { bd = d; best = x; } }
  return best ? { x: best, km: bd } : null;
}

export interface Box { aoi: string; lat0: number; lat1: number; lon0: number; lon1: number }
/** AOI boxes from the 46x46 tile centres, padded half a tile */
export function aoiBoxes(tiles: { aoi: string; lat: number; lon: number }[]): Box[] {
  const by = new Map<string, Box>();
  for (const t of tiles) {
    const b = by.get(t.aoi) ?? { aoi: t.aoi, lat0: 90, lat1: -90, lon0: 180, lon1: -180 };
    b.lat0 = Math.min(b.lat0, t.lat); b.lat1 = Math.max(b.lat1, t.lat); b.lon0 = Math.min(b.lon0, t.lon); b.lon1 = Math.max(b.lon1, t.lon);
    by.set(t.aoi, b);
  }
  return [...by.values()].map((b) => { const dy = (b.lat1 - b.lat0) / 45 / 2, dx = (b.lon1 - b.lon0) / 45 / 2; return { aoi: b.aoi, lat0: b.lat0 - dy, lat1: b.lat1 + dy, lon0: b.lon0 - dx, lon1: b.lon1 + dx }; });
}
export const SITING_BOX: Box = { aoi: "pvg", lat0: 13.8263, lat1: 14.3735, lon0: 77.0001, lon1: 77.5605 };
export const inBox = (b: Box, p: LL) => p.lat >= b.lat0 && p.lat <= b.lat1 && p.lon >= b.lon0 && p.lon <= b.lon1;

/** WGS84 lon/lat -> UTM easting/northing in the given zone (northern hemisphere) */
export function utm(p: LL, zone: number, south = false) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180;
  const phi = p.lat * r, lam = (p.lon - ((zone - 1) * 6 - 180 + 3)) * r;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, Cc = ep2 * Math.cos(phi) ** 2, A = lam * Math.cos(phi);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + Cc) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * Cc - 58 * ep2) * A ** 5) / 120) + 500000;
  const y = k0 * (M + N * Math.tan(phi) * ((A * A) / 2 + ((5 - T + 9 * Cc + 4 * Cc * Cc) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * Cc - 330 * ep2) * A ** 6) / 720));
  return { x, y: south ? y + 1e7 : y };
}
