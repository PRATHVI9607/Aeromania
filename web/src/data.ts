import type { ParamMeta, Params, Query, Station, Tile, TrackPt, Window } from "./types";

export interface Data {
  tiles: Tile[]; wins: Window[]; passes: Window[]; track: TrackPt[]; stations: Station[]; queries: Query[];
  params: Params; meta: Record<string, ParamMeta>; results: any | null; reports: Record<string, any>; sample: string[]; synthetic: boolean;
}

const cache = new Map<string, Promise<any | null>>();
/** one fetch per file for the whole session, shared by loadData, useJson and the views */
function get(path: string): Promise<any | null> {
  let p = cache.get(path); if (!p) { p = fetchOnce(path); cache.set(path, p); } return p;
}
async function fetchOnce(path: string): Promise<any | null> {
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
  const [t, w, tr, q, repIdx, st, results, sw] = await Promise.all(
    ["tiles.json", "windows.json", "track.json", "queries.json", "reports/index.json", "reports/stations.json", "results.json", "sched_windows.json"].map(get));
  const missing = [["tiles", t], ["windows", w], ["track", tr], ["queries", q]].filter(([, v]) => !v).map(([k]) => k as string);
  if (missing.length) throw new Error(`required data files missing in web/public/data: ${missing.join(", ")}. Run the sim step.`);
  const tiles: Tile[] = normTiles(t);
  const track = normTrack(tr);
  // sched_windows.json = contact windows split at capture times (python sim); same list the python scheduler used, so live recompute matches it.
  const passes: Window[] = w.windows.filter((x: Window) => x.start_min >= (w.first_capture_min ?? 0)); // real contact passes (Mission view)
  const wins: Window[] = sw?.windows ?? w.windows.filter((x: Window) => x.start_min >= (w.first_capture_min ?? 0));
  const queries: Query[] = q.queries;
  const stations: Station[] = st?.stations ?? [];
  const params = Object.fromEntries(Object.entries(q.params).map(([k, v]: [string, any]) => [k, v.value])) as unknown as Params;
  const meta: Record<string, ParamMeta> = Object.fromEntries(Object.entries(q.params).map(([k, v]: [string, any]) => [k, { assumption: !!v.assumption, source: v.source }]));
  const reports: Record<string, any> = {};
  await Promise.all((repIdx ?? []).map(async (f: string) => { reports[f.replace(/\.json$/, "")] = await get(`reports/${f}`); }));
  const synthetic = [t, w, tr, q].some((x) => x && x.synthetic === true);
  return { tiles, wins, passes, track, stations, queries, params, meta, results, reports, sample: [], synthetic };
}

/** Fetch one optional JSON from /data; null if absent. */
export const fetchJson = get;
