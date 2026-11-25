// Live mode: Element84 Earth Search STAC + sentinel-cogs range reads (geotiff.js) + NASA POWER. All CORS-enabled public endpoints.
import { fromUrl } from "geotiff";
import { cost, type SitePar } from "../sitingEcon";
import { utm, type LL } from "./geo";

export const STAC = "https://earth-search.aws.element84.com/v1/search";
export const WIN = 192;
const ASSETS = ["blue", "green", "red", "nir", "swir16"] as const;

export interface Scene { id: string; datetime: string; cloud: number; epsg: number; baseline: number; assets: Record<string, { href: string; transform: number[]; shape: number[] }> }

const toScene = (f: any): Scene => ({
  id: f.id, datetime: f.properties.datetime, cloud: f.properties["eo:cloud_cover"], epsg: f.properties["proj:epsg"],
  baseline: parseFloat(f.properties["s2:processing_baseline"] ?? "0"),
  assets: Object.fromEntries(ASSETS.map((a) => [a, { href: f.assets[a].href, transform: f.assets[a]["proj:transform"], shape: f.assets[a]["proj:shape"] }])),
});

async function search(p: LL, datetime?: string): Promise<Scene[]> {
  const body: any = { collections: ["sentinel-2-l2a"], intersects: { type: "Point", coordinates: [p.lon, p.lat] }, query: { "eo:cloud_cover": { lt: 20 } }, sortby: [{ field: "properties.datetime", direction: "desc" }], limit: 10 };
  if (datetime) body.datetime = datetime;
  const r = await fetch(STAC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Earth Search STAC ${r.status}`);
  return (await r.json()).features.map(toScene);
}

/** newest scene with cloud < 20, plus the same-season (+-60 d) scene one year earlier on the same UTM zone */
export async function findPair(p: LL): Promise<{ after: Scene; before: Scene }> {
  const [after] = await search(p);
  if (!after) throw new Error("No Sentinel-2 L2A scene with < 20% cloud covers this point.");
  const t = Date.parse(after.datetime) - 365.25 * 864e5, d = (x: number) => new Date(x).toISOString().slice(0, 10);
  const cands = (await search(p, `${d(t - 60 * 864e5)}T00:00:00Z/${d(t + 60 * 864e5)}T23:59:59Z`)).filter((s) => s.epsg === after.epsg);
  if (!cands.length) throw new Error("No cloud-free scene from the same season a year earlier.");
  cands.sort((a, b) => Math.abs(Date.parse(a.datetime) - t) - Math.abs(Date.parse(b.datetime) - t));
  return { after, before: cands[0] };
}

/** 192x192 px window at 10 m, 20 m grid aligned in UTM so both dates overlay; planar [5,W,W] DN with BOA offset applied */
export async function readWindow(s: Scene, p: LL): Promise<Uint16Array> {
  const zone = s.epsg % 100, u = utm(p, zone, s.epsg >= 32700);
  const X0 = Math.floor(u.x / 20) * 20 - (WIN / 2) * 10, Y0 = Math.floor(u.y / 20) * 20 + (WIN / 2) * 10;
  const [, , ox, , , oy] = s.assets.blue.transform;
  const col0 = (X0 - ox) / 10, row0 = (oy - Y0) / 10, n = s.assets.blue.shape[0];
  if (col0 < 0 || row0 < 0 || col0 + WIN > n || row0 + WIN > n) throw new Error("The point is too close to the scene edge for a 192 px window.");
  const out = new Uint16Array(5 * WIN * WIN), off = s.baseline >= 4 ? 1000 : 0;
  await Promise.all(ASSETS.map(async (a, k) => {
    const img = await (await fromUrl(s.assets[a].href)).getImage();
    const coarse = a === "swir16", c0 = coarse ? Math.floor(col0 / 2) : col0, r0 = coarse ? Math.floor(row0 / 2) : row0, w = coarse ? Math.floor((col0 + WIN - 1) / 2) - c0 + 1 : WIN, h = coarse ? Math.floor((row0 + WIN - 1) / 2) - r0 + 1 : WIN;
    const [r] = (await img.readRasters({ window: [c0, r0, c0 + w, r0 + h], interleave: false })) as unknown as ArrayLike<number>[];
    for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
      const v = coarse ? r[(Math.floor((row0 + y) / 2) - r0) * w + (Math.floor((col0 + x) / 2) - c0)] : r[y * w + x];
      out[k * WIN * WIN + y * WIN + x] = v === 0 ? 0 : Math.max(0, v - off);
    }
  }));
  return out;
}

export interface Power { ghi: number; ws50: number; t2m: number }
export async function power(p: LL): Promise<Power> {
  const r = await fetch(`https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,WS50M,T2M&community=RE&longitude=${p.lon.toFixed(4)}&latitude=${p.lat.toFixed(4)}&format=JSON`);
  if (!r.ok) throw new Error(`NASA POWER ${r.status}`);
  const q = (await r.json()).properties.parameter;
  return { ghi: q.ALLSKY_SFC_SW_DWN.ANN, ws50: q.WS50M.ANN, t2m: q.T2M.ANN };
}

/** per-MW solar economics, same formulas as python siting.py (pr_adj, CUF, econ); grid and road distances unknown -> 0 */
export function solarEcon(w: Power, S0: any) {
  const S = Object.fromEntries(Object.entries(S0).map(([k, v]: [string, any]) => [k, v && typeof v === "object" && "v" in v ? v.v : v])) as any; // params are {v, src}
  const pr = S.pr * (1 - S.temp_coeff_per_c * Math.max(0, w.t2m + S.t_cell_rise_c - 25)), cuf = (w.ghi * 365 * pr) / 8760, mwh = 8760 * cuf;
  const P: SitePar = { wacc: S.wacc, life_yr: S.life_yr, om_lakh_per_mw_yr: S.om_lakh_per_mw_yr, capex_cr_per_mw: S.capex_cr_per_mw, grid_cr_per_km: S.grid_cr_per_km, road_cr_per_km: S.road_cr_per_km, tariff_rs_kwh: S.tariff_rs_kwh };
  const c = cost({ mw: 1, mwh_yr: mwh, revenue_rs_yr: 0, net_value_rs_yr: 0, grid_km_substation: 0, road_km: 0 }, P);
  return { cuf, lcoe: c / (mwh * 1000), tariff: S.tariff_rs_kwh as number };
}
