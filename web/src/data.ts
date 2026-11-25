import type { ParamMeta, Params, Query, Station, Tile, TrackPt, Window } from "./types";
import { defaultMeta, defaultParams, mockQueries, mockTiles, mockTrack, mockWindows, stations as mockStations } from "./mock/mock";

export interface Data {
  tiles: Tile[]; wins: Window[]; track: TrackPt[]; stations: Station[]; queries: Query[];
  params: Params; meta: Record<string, ParamMeta>; reports: Record<string, any>; sample: string[]; synthetic: boolean;
}

async function get(path: string): Promise<any | null> {
  try {
    const r = await fetch(`/data/${path}`);
    if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) return null;
    return await r.json();
  } catch { return null; }
}

function normTiles(j: any): Tile[] {
  const classes: string[] = j.classes ?? [];
  return j.rows.map((r: any[]) => {
    const o = Object.fromEntries(j.fields.map((f: string, k: number) => [f, r[k]]));
    return { ...o, cls: typeof o.cls === "number" ? classes[o.cls] ?? String(o.cls) : o.cls } as Tile;
  });
}
function normTrack(j: any): TrackPt[] {
  const dt = j.step_s / 60;
  return j.lat.map((lat: number, i: number) => ({ t_min: i * dt, lat, lon: j.lon[i] }));
}

export async function loadData(): Promise<Data> {
  const [t, w, tr, q, repIdx, st] = await Promise.all(
    ["tiles.json", "windows.json", "track.json", "queries.json", "reports/index.json", "reports/stations.json"].map(get));
  const sample: string[] = [];
  const tiles: Tile[] = t ? normTiles(t) : (sample.push("tiles"), mockTiles());
  const track = tr ? normTrack(tr) : (sample.push("track"), mockTrack());
  const wins: Window[] = w ? w.windows.filter((x: Window) => x.start_min >= (w.first_capture_min ?? 0)) : (sample.push("windows"), mockWindows(track));
  const queries: Query[] = q ? q.queries : (sample.push("queries"), mockQueries);
  const stations: Station[] = st?.stations ?? (st ? [] : mockStations);
  let params = defaultParams, meta = defaultMeta;
  if (q?.params) {
    params = Object.fromEntries(Object.entries(q.params).map(([k, v]: [string, any]) => [k, v.value])) as unknown as Params;
    meta = Object.fromEntries(Object.entries(q.params).map(([k, v]: [string, any]) => [k, { assumption: !!v.assumption, source: v.source }]));
  } else sample.push("params");
  const reports: Record<string, any> = {};
  await Promise.all((repIdx ?? []).map(async (f: string) => { reports[f.replace(/\.json$/, "")] = await get(`reports/${f}`); }));
  const synthetic = [t, w, tr, q].some((x) => x && x.synthetic === true);
  return { tiles, wins, track, stations, queries, params, meta, reports, sample, synthetic };
}
