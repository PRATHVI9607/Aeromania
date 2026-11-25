import { Skeleton, ViewHead } from "../ui";
import { useState } from "react";
import { useJson } from "../useJson";
import { Rupee } from "../Assume";
import { Shortlist } from "./Shortlist";
import { explain } from "../explain";
import type { ViewProps } from "./props";
import { Scatter } from "../charts";

const SZ = 600;
/** number or "n/a"; never renders undefined */
const nf = (x: unknown, d = 1) => (typeof x === "number" && isFinite(x) && x !== 0 ? x.toFixed(d) : x === 0 ? "0" : "n/a");
const f0 = (x: number) => Math.round(x).toLocaleString("en-IN");

export function Siting({ data }: ViewProps) {
  const s = useJson<any>("siting.json");
  const [kind, setKind] = useState<"solar" | "wind">("solar");
  const [hover, setHover] = useState<any>(null), [tbl, setTbl] = useState(false), [pick, setPick] = useState<string | null>(null);
  if (s === undefined) return <Skeleton />;
  if (s === null) return <section className="panel"><h3>Siting <small>not generated yet</small></h3><p className="muted">web/public/data/siting.json is missing. Run the siting step (python -m herald siting).</p></section>;
  if (!Array.isArray(s.cells) || !s.cells.length || !Array.isArray(s.bbox) || s.bbox.length !== 4) return <section className="panel"><h3>Siting <small>data incomplete</small></h3><p className="muted">siting.json has no cells or bbox. Re-run python -m herald siting.</p></section>;
  const [w, so, e, n] = s.bbox as number[];
  const flip = s.cells[0].lat < s.cells[s.cells.length - 1].lat; // image row 0 must be north
  const pos = (lat: number, lon: number) => [((lon - w) / (e - w)) * SZ, ((n - lat) / (n - so)) * SZ];
  const top: any[] = kind === "solar" ? s.top_solar : s.top_wind;
  const sp = data.reports.siting?.params?.[kind] ?? {};
  const meta = (k: string) => ({ assumption: true, source: `${sp[k]?.src ?? sp[k]?.source ?? s.params.note}` });
  const rsKey = Object.keys(sp).find((k) => /tariff/.test(k)) ?? "tariff_rs_kwh";
  const v = s.validation;
  const pv = v?.pavagada_park;
  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const j = Math.floor(((ev.clientX - r.left) / r.width) * s.n), i = Math.floor(((ev.clientY - r.top) / r.height) * s.n);
    const ii = flip ? s.n - 1 - i : i;
    setHover(s.cells[ii * s.n + j]);
  };
  return (
    <div className="ins">
      <ViewHead explain={explain("siting", data)} kicker="Track A" title="Renewable siting" sub={<span className="chip">Pavagada, Karnataka, 60 km box; screening ranks, rupee values are assumptions</span>} />
      <div className="grid2">
        {tbl ? <div className="span2x"><button onClick={() => setTbl(false)} style={{ marginBottom: 8 }}>Show chart</button><Shortlist s={s} rep={data.reports.siting} kind={kind} setKind={setKind} /></div> : (
          <section className="panel span2x">
            <h3>Top sites <small>cost per unit vs size; hover a point</small>
              <span className="btns">{(["solar", "wind"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}<button onClick={() => setTbl(true)}>Show table</button></span></h3>
            <Scatter xLabel="Block size, MW" yLabel="LCOE, Rs per kWh" fx={(v) => v.toFixed(0)} fy={(v) => v.toFixed(2)} active={pick} onPick={(k) => setPick(pick === k ? null : k)}
              pts={top.map((t: any) => ({ key: String(t.rank), x: t.mw, y: t.lcoe_rs_kwh, label: `${kind} site #${t.rank}`, note: `${Math.round(t.mwh_yr).toLocaleString("en-IN")} MWh/yr, grid ${t.grid_km_substation} km, net ${Math.round(t.net_value_rs_yr / 1e5) / 10} Cr/yr (assumption)` }))} />
          </section>)}
        <section className="panel">
          <h3>Heatmap
            <span className="controls">
              {(["solar", "wind"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}
            </span></h3>
          <div className="mosaic" style={{ width: "100%", maxWidth: SZ, aspectRatio: "1" }}>
            <img src={`/data/${s.images[kind]}`} alt={`${kind} suitability heatmap`} width={SZ} height={SZ} style={{ transform: flip ? "scaleY(-1)" : undefined, imageRendering: "pixelated" }} />
            <svg viewBox={`0 0 ${SZ} ${SZ}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
              {top.map((t) => { const [x, y] = pos(t.lat, t.lon); return <g key={t.rank}><circle cx={x} cy={y} r={7} fill="none" stroke="#fff" strokeWidth={1.5} /><text x={x} y={y - 10} fill="#fff" fontSize={10} textAnchor="middle" fontFamily="monospace">{t.rank}</text></g>; })}
            </svg>
          </div>
          <div className="legend"><span><i style={{ background: "#440154" }} />low</span><span><i style={{ background: "#21918c" }} />mid</span><span><i style={{ background: "#fde725" }} />high (rank-normalised among ranked cells)</span><span>transparent = excluded or unranked</span></div>
          {hover && <p className="mono muted">cell {nf(hover.lat, 3)}, {nf(hover.lon, 3)}: solar rank {hover.solar_score || "-"}, wind rank {hover.wind_score || "-"}, T2M {nf(hover.t2m, 1)} C, WS50 {nf(hover.ws50, 1)} m/s, road {nf(hover.road_km, 1)} km{hover.cluster_mw != null ? `, cluster ${nf(hover.cluster_mw, 0)} MW` : ""}{hover.lcoe_rs_kwh != null ? `, LCOE ${nf(hover.lcoe_rs_kwh, 2)}` : ""}</p>}
        </section>
        <section className="panel">
          <h3>Validation</h3>
          {pv && <dl className="dl">
            <dt>Pavagada solar park cells</dt><dd className="mono">{pv.cells} cells; mean percentile {pv.as_is.mean_pct ?? "n/a"} as is, {pv.built_treated_as_available.mean_pct ?? "n/a"} with built land treated as available; {pv.as_is.share_top_decile != null ? `${(pv.as_is.share_top_decile * 100).toFixed(0)}% in top decile` : ""}</dd>
            <dt>OSM polygon area</dt><dd className="mono">{pv.footprint_polygon_ha} ha vs ~{pv.reference_ha} ha reference</dd>
            {v.other_osm_solar && <><dt>Other OSM solar</dt><dd className="mono">{v.other_osm_solar.as_is.n_cells} cells, mean percentile {v.other_osm_solar.as_is.mean_pct ?? "n/a"}</dd></>}
            {v.sensitivity?.top20_overlap_with_base && <><dt>Top-20 overlap with base</dt><dd className="mono">{Object.entries(v.sensitivity.top20_overlap_with_base).map(([k, x]) => `${k}: ${x}/20`).join(", ")}</dd></>}
          </dl>}
          <details className="how"><summary>Caveats</summary><ul className="limits">{(s.caveats ?? []).map((c: string) => <li key={c}>{c}</li>)}</ul></details>
        </section>
        
      </div>
    </div>
  );
}
