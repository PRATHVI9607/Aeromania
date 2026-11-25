import { useMemo, useState } from "react";
import { Info, Empty } from "../kit";
import { download, SHORT_KEY, toCSV, toGeoJSON, useLocal } from "../work";
import { reprice, type SitePar } from "../sitingEcon";
import { inr } from "../fmt";

const COLS = ["rank", "kind", "lat", "lon", "mw", "mwh_yr", "tariff_rs_kwh", "capex_cr_per_mw", "lcoe_rs_kwh", "net_rs_yr", "viable", "grid_km_substation", "road_km", "crop_share", "reasons"];
const f1 = (x: number, d = 1) => x.toFixed(d);

export function Shortlist({ s, rep, kind, setKind }: { s: any; rep: any; kind: "solar" | "wind"; setKind: (k: "solar" | "wind") => void }) {
  const P = rep?.params?.[kind] ?? {};
  const base: SitePar = { wacc: P.wacc?.v ?? 0.095, life_yr: P.life_yr?.v ?? 25, om_lakh_per_mw_yr: P.om_lakh_per_mw_yr?.v ?? 4, capex_cr_per_mw: P.capex_cr_per_mw?.v ?? 3.7, grid_cr_per_km: P.grid_cr_per_km?.v ?? 0.8, road_cr_per_km: P.road_cr_per_km?.v ?? 0.5, tariff_rs_kwh: P.tariff_rs_kwh?.v ?? 2.6 };
  const [tariff, setTariff] = useState<number | null>(null), [capex, setCapex] = useState<number | null>(null);
  const [maxGrid, setMaxGrid] = useState(5), [maxRoad, setMaxRoad] = useState(5), [minMw, setMinMw] = useState(0), [maxCrop, setMaxCrop] = useState(1), [onlyViable, setOnlyViable] = useState(false);
  const [pins, setPins] = useLocal<string[]>(SHORT_KEY, []);
  const now = { ...base, tariff_rs_kwh: tariff ?? base.tariff_rs_kwh, capex_cr_per_mw: capex ?? base.capex_cr_per_mw };
  const key = (t: any, k = kind) => `${k}:${t.rank}`;
  const rows = useMemo(() => (kind === "solar" ? s.top_solar : s.top_wind).map((t: any) => ({ ...t, kind, crop: t.land_mix?.crop ?? 0, ...reprice(t, base, now) })),
    [s, kind, now.tariff_rs_kwh, now.capex_cr_per_mw]); // eslint-disable-line
  const list = rows.filter((t: any) => Math.max(t.grid_km_substation, t.grid_km_line33 ?? 0) <= maxGrid + 1e9 && t.grid_km_substation <= maxGrid && t.road_km <= maxRoad && t.mw >= minMw && t.crop <= maxCrop && (!onlyViable || t.viable));
  const all = useMemo(() => [...(s.top_solar as any[]).map((t) => ({ ...t, kind: "solar" })), ...(s.top_wind as any[]).map((t) => ({ ...t, kind: "wind" }))], [s]);
  const pinned = all.filter((t) => pins.includes(key(t, t.kind))).map((t) => { const Pk = rep?.params?.[t.kind] ?? {}; const b: SitePar = { ...base, om_lakh_per_mw_yr: Pk.om_lakh_per_mw_yr?.v ?? base.om_lakh_per_mw_yr, capex_cr_per_mw: Pk.capex_cr_per_mw?.v ?? base.capex_cr_per_mw, tariff_rs_kwh: Pk.tariff_rs_kwh?.v ?? base.tariff_rs_kwh, grid_cr_per_km: Pk.grid_cr_per_km?.v ?? base.grid_cr_per_km };
    return { ...t, crop: t.land_mix?.crop ?? 0, ...reprice(t, b, t.kind === kind ? { ...b, tariff_rs_kwh: now.tariff_rs_kwh, capex_cr_per_mw: now.capex_cr_per_mw } : b) }; });
  const toggle = (t: any) => setPins((p) => (p.includes(key(t)) ? p.filter((x) => x !== key(t)) : [...p, key(t)]));
  const out = () => pinned.map((t) => ({ rank: t.rank, kind: t.kind, lat: t.lat, lon: t.lon, mw: t.mw, mwh_yr: t.mwh_yr, tariff_rs_kwh: t.kind === kind ? now.tariff_rs_kwh : "", capex_cr_per_mw: t.kind === kind ? now.capex_cr_per_mw : "", lcoe_rs_kwh: +t.lcoe.toFixed(2), net_rs_yr: Math.round(t.net), viable: t.viable, grid_km_substation: t.grid_km_substation, road_km: t.road_km, crop_share: t.crop, reasons: t.reasons.join("; ") }));
  const cmp = pinned.slice(0, 3);
  return (
    <section className="panel span2x">
      <h3>Shortlist builder <small>the 20 best cells per technology from siting.json; constraints and economics re-price live</small>
        <span className="btns"><button onClick={() => download("herald_siting_shortlist.csv", "text/csv", toCSV(out(), COLS))} disabled={!pinned.length}>Shortlist CSV</button>
          <button onClick={() => download("herald_siting_shortlist.geojson", "application/geo+json", JSON.stringify(toGeoJSON(out().map((r) => ({ lat: r.lat, lon: r.lon, name: `${r.kind} rank ${r.rank}`, props: r }))), null, 1))} disabled={!pinned.length}>GeoJSON</button></span></h3>
      <div className="frow">
        <div className="seg" role="group" aria-label="Technology">{(["solar", "wind"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}</div>
        <label className="fsel">Max grid km<input type="number" min={0} step={0.5} value={maxGrid} onChange={(e) => setMaxGrid(+e.target.value)} /></label>
        <label className="fsel">Max road km<input type="number" min={0} step={0.5} value={maxRoad} onChange={(e) => setMaxRoad(+e.target.value)} /></label>
        <label className="fsel">Min block MW<input type="number" min={0} step={5} value={minMw} onChange={(e) => setMinMw(+e.target.value)} /></label>
        <label className="fsel">Max cropland share<input type="number" min={0} max={1} step={0.1} value={maxCrop} onChange={(e) => setMaxCrop(+e.target.value)} /></label>
        <label className="fsel">Tariff Rs/kWh<input type="number" min={0} step={0.1} value={tariff ?? base.tariff_rs_kwh} onChange={(e) => setTariff(+e.target.value)} /></label>
        <label className="fsel">Capex Cr/MW<input type="number" min={0} step={0.1} value={capex ?? base.capex_cr_per_mw} onChange={(e) => setCapex(+e.target.value)} /></label>
        <label className="fchk"><input type="checkbox" checked={onlyViable} onChange={(e) => setOnlyViable(e.target.checked)} />Viable only (LCOE below tariff)</label>
        <button onClick={() => { setTariff(null); setCapex(null); setMaxGrid(5); setMaxRoad(5); setMinMw(0); setMaxCrop(1); setOnlyViable(false); }}>Reset</button>
        <Info title="LCOE and viability">Annual cost = MW x (O&M + capex x CRF) + (grid km x grid cost + road km x road cost) x CRF, with CRF = wacc / (1 - (1 + wacc)^-life) at {(base.wacc * 100).toFixed(1)}% over {base.life_yr} years. LCOE = cost / MWh. Viable when LCOE is below the tariff. Same formula as python/herald/siting.py; edited tariff and capex re-price the generated cells. Every input is an assumption.</Info>
      </div>
      {list.length === 0 ? <Empty title="No cell passes these constraints">Relax grid, road or cropland limits.</Empty> :
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Pin</th><th>#</th><th className="r">MW</th><th className="r">MWh/yr</th><th className="r">LCOE Rs/kWh</th><th className="r">Net Rs/yr</th><th className="r">Grid km</th><th className="r">Road km</th><th className="r">Crop</th><th>Why it ranks</th></tr></thead>
          <tbody>{list.map((t: any) => <tr key={t.rank}><td><input type="checkbox" aria-label={`Pin ${kind} ${t.rank}`} checked={pins.includes(key(t))} onChange={() => toggle(t)} /></td><td className="mono">{t.rank}</td><td className="mono r">{t.mw}</td><td className="mono r">{Math.round(t.mwh_yr).toLocaleString("en-IN")}</td>
            <td className={`mono r ${t.viable ? "ok" : ""}`}>{f1(t.lcoe, 2)}</td><td className={`mono r ${t.net >= 0 ? "ok" : "bad"}`}>{inr(t.net)}</td><td className="mono r">{t.grid_km_substation}</td><td className="mono r">{t.road_km}</td><td className="mono r">{(t.crop * 100).toFixed(0)}%</td><td className="reasons">{t.reasons?.[1] ?? t.reasons?.[0] ?? ""}</td></tr>)}</tbody></table></div>}
      <h3 className="grp">Compare pinned <small>{pinned.length} pinned{pinned.length > 3 ? ", first 3 compared" : ""}</small></h3>
      {cmp.length === 0 ? <span className="chip">Pin up to three cells to compare</span> :
        <div className="tblwrap"><table className="tbl"><thead><tr><th />{cmp.map((t) => <th key={key(t, t.kind)} className="r">{t.kind} #{t.rank}</th>)}</tr></thead><tbody>
          {([["MW", (t: any) => t.mw], ["MWh/yr", (t: any) => Math.round(t.mwh_yr).toLocaleString("en-IN")], ["LCOE Rs/kWh", (t: any) => f1(t.lcoe, 2)], ["Net Rs/yr", (t: any) => inr(t.net)], ["Viable", (t: any) => (t.viable ? "yes" : "no")], ["Grid km", (t: any) => t.grid_km_substation], ["Road km", (t: any) => t.road_km], ["Cropland", (t: any) => `${(t.crop * 100).toFixed(0)}%`], ["Slope deg", (t: any) => t.slope_mean_deg], ["Cluster MW", (t: any) => t.cluster_mw], ["Lat, lon", (t: any) => `${t.lat}, ${t.lon}`]] as [string, (t: any) => any][]).map(([l, g]) => <tr key={l}><td className="dim">{l}</td>{cmp.map((t) => <td key={key(t, t.kind)} className="mono r">{g(t)}</td>)}</tr>)}</tbody></table></div>}
    </section>
  );
}
