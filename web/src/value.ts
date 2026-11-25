// Exact port of python/herald/value.py.
import type { Params, Query, Tile } from "./types";

export function levelBytes(fullBytes: number, p: Params): number[] {
  const [pk, th] = p.level_bytes;
  return [pk, th, Math.max(Math.trunc(fullBytes), th + 1)];
}

export function match(t: Tile, q: Query): boolean {
  return q.aois.includes(t.aoi) && t.sev >= q.min_sev;
}

export function tileValue(t: Tile, queries: Query[], p: Params): number {
  let v = 0.0;
  for (const q of queries) {
    if (match(t, q)) {
      const pr = q.pack === "A" ? t.pA : t.pC;
      v += pr * t.ha * p.rupees_per_ha[q.pack] * (1 - t.cloud) * q.priority;
    }
  }
  return v;
}
