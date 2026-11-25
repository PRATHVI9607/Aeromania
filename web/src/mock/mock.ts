// Sample data used ONLY when a /data/*.json fetch 404s. UI shows a "sample data" badge. Never written to disk.
import type { ParamMeta, Params, Query, Station, Tile, TrackPt, Window } from "../types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const D = Math.PI / 180;

export const stations: Station[] = [
  { id: "bengaluru", name: "Bengaluru", lat: 13.03, lon: 77.57 }, { id: "svalbard", name: "Svalbard", lat: 78.23, lon: 15.39 },
  { id: "kiruna", name: "Kiruna", lat: 67.86, lon: 20.96 }, { id: "fairbanks", name: "Fairbanks", lat: 64.84, lon: -147.72 },
  { id: "hartebeesthoek", name: "Hartebeesthoek", lat: -25.89, lon: 27.69 }, { id: "punta_arenas", name: "Punta Arenas", lat: -53.16, lon: -70.91 },
];

export function mockTrack(): TrackPt[] {
  const inc = 98.62 * D, period = 100.43, out: TrackPt[] = [];
  for (let t = 0; t <= 1440; t += 1) {
    const u = (2 * Math.PI * t) / period;
    const lat = Math.asin(Math.sin(inc) * Math.sin(u)) / D;
    let lon = Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u)) / D - (t / 1440) * 360 + 40;
    lon = ((lon + 540) % 360) - 180;
    out.push({ t_min: t, lat, lon });
  }
  return out;
}

export function mockWindows(track: TrackPt[]): Window[] {
  const wins: Window[] = [];
  for (const st of stations) {
    let open: number | null = null;
    for (const p of track) {
      const c = Math.sin(st.lat * D) * Math.sin(p.lat * D) + Math.cos(st.lat * D) * Math.cos(p.lat * D) * Math.cos((st.lon - p.lon) * D);
      const inside = Math.acos(Math.min(1, c)) / D < 18.76;
      if (inside && open === null) open = p.t_min;
      if (!inside && open !== null) {
        if (p.t_min - open >= 2) wins.push({ id: 0, station: st.id, start_min: open, end_min: p.t_min });
        open = null;
      }
    }
  }
  wins.sort((a, b) => a.start_min - b.start_min);
  wins.forEach((w, i) => (w.id = i));
  return wins;
}

export function mockTiles(): Tile[] {
  const r = rng(7), tiles: Tile[] = [];
  const aois: [string, number, number][] = [["blr", 13.17, 77.62], ["sone", 25.5, 84.75], ["hasdeo", 22.82, 82.68]];
  const dates: [string, number, number][] = [["t1", 30, 0.05], ["c1", 200, 0.45], ["c2", 400, 0.3]];
  const classes = ["Industrial", "Residential", "Forest", "River", "AnnualCrop", "HerbaceousVegetation"];
  let id = 0;
  for (const [aoi, lat0, lon0] of aois) for (const [date, tcap, cl] of dates)
    for (let row = 0; row < 46; row++) for (let col = 0; col < 46; col++) {
      const cloud = Math.min(1, Math.max(0, cl * (0.3 + 1.4 * r()) * (r() < 0.2 ? 0.1 : 1.3)));
      const hot = r() < 0.06;
      const sev = hot ? 0.3 + 0.7 * r() : 0.25 * r();
      tiles.push({
        id: id++, aoi, date, t_cap_min: tcap + row * 0.3, lat: lat0 + (23 - row) * 0.0058, lon: lon0 + (col - 23) * 0.0062,
        cls: classes[Math.floor(r() * classes.length)], conf: 0.5 + 0.5 * r(), cloud, kind: hot ? "construction" : "none",
        sev, ha: hot ? 2 + 20 * r() : 0.5 * r(), pA: hot ? 0.5 + 0.5 * r() : 0.1 * r(), pC: hot ? 0.4 + 0.6 * r() : 0.1 * r(),
        full_bytes: Math.round(22000 + 9000 * r()),
      });
    }
  return tiles;
}

export const mockQueries: Query[] = [
  { id: "q1", name: "Sample: Bengaluru construction", pack: "A", aois: ["blr"], min_sev: 0.3, priority: 1 },
  { id: "q2", name: "Sample: Sone sand", pack: "C", aois: ["sone"], min_sev: 0.3, priority: 1.5 },
  { id: "q3", name: "Sample: Hasdeo clearing", pack: "C", aois: ["hasdeo"], min_sev: 0.3, priority: 1.2 },
];

export const defaultParams: Params = {
  rupees_per_ha: { A: 6000, C: 4000 }, level_fraction: [0.7, 0.85, 1], level_bytes: [256, 2400],
  half_life_h: 48, pull_threshold: 5000, cloud_drop: 0.7, link_mbps: 100, link_efficiency: 0.7, rupees_per_contact_min: 5000,
};
export const defaultMeta: Record<string, ParamMeta> = Object.fromEntries(Object.keys(defaultParams).map((k) => [k, { assumption: true, source: "Sample value (config/value.json not served). Not measured." }]));
