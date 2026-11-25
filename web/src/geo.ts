import type { Tile } from "./types";
const N = 46;
/** lat/lon -> fraction (0..1) of the AOI t1 mosaic, from tile-centre extremes (same method the ledger map uses; tens of metres of error). */
export function aoiGeo(tiles: Tile[], aoi: string): ((lat: number, lon: number) => [number, number]) | null {
  const t = tiles.filter((x) => x.aoi === aoi && x.date === "t1");
  if (t.length < N * N) return null;
  const a = t[0], b = t[N * N - 1];
  return (lat, lon) => [(0.5 + ((lon - a.lon) / (b.lon - a.lon)) * (N - 1)) / N, (0.5 + ((lat - a.lat) / (b.lat - a.lat)) * (N - 1)) / N];
}
