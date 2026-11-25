import { Skeleton, ViewHead } from "../ui";
import { useState } from "react";
import { useJson } from "../useJson";
import { Rupee } from "../Assume";
import type { ViewProps } from "./props";

const SZ = 600;
const f0 = (x: number) => Math.round(x).toLocaleString("en-IN");

export function Siting({ data }: ViewProps) {
  const s = useJson<any>("siting.json");
  const [kind, setKind] = useState<"solar" | "wind">("solar");
  const [hover, setHover] = useState<any>(null);
  if (s === undefined) return <Skeleton />;
  if (s === null) return <section className="panel"><h3>Siting <small>not generated yet</small></h3><p className="muted">web/public/data/siting.json is missing. Run the siting step (python -m herald siting).</p></section>;
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
      <ViewHead kicker="Track A, objective 2" title="Where the next gigawatt should go" sub="Solar and wind sites ranked by irradiance, slope, land use and grid distance, validated against the real Pavagada park. 60 x 60 km box around Pavagada, Karnataka. Screening ranks, not site surveys. Rupee values are assumptions (hover for the parameter and source)." />
      <div className="grid2">
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
          {hover && <p className="mono muted">cell {hover.lat}, {hover.lon}: solar rank {hover.solar_score || "-"}, wind rank {hover.wind_score || "-"}, GHI {hover.ghi}, WS50 {hover.ws50} m/s, slope {hover.slope} deg</p>}
        </section>
        <section className="panel">
          <h3>Validation <small>sanity checks, not proof</small></h3>
          {pv && <dl className="dl">
            <dt>Pavagada solar park cells</dt><dd className="mono">{pv.cells} cells; mean percentile {pv.as_is.mean_pct ?? "n/a"} as is, {pv.built_treated_as_available.mean_pct ?? "n/a"} with built land treated as available; {pv.as_is.share_top_decile != null ? `${(pv.as_is.share_top_decile * 100).toFixed(0)}% in top decile` : ""}</dd>
            <dt>OSM polygon area</dt><dd className="mono">{pv.footprint_polygon_ha} ha vs ~{pv.reference_ha} ha reference</dd>
            {v.other_osm_solar && <><dt>Other OSM solar</dt><dd className="mono">{v.other_osm_solar.as_is.n_cells} cells, mean percentile {v.other_osm_solar.as_is.mean_pct ?? "n/a"}</dd></>}
            {v.sensitivity_top20_overlap_of_20 && <><dt>Top-20 overlap under variants</dt><dd className="mono">{Object.entries(v.sensitivity_top20_overlap_of_20).map(([k, x]) => `${k}: ${x}/20`).join(", ")}</dd></>}
          </dl>}
          {pv && <p className="muted">{pv.note}</p>}
          <h3 style={{ marginTop: 12 }}>Caveats</h3>
          <ul className="limits">{(s.caveats ?? []).map((c: string) => <li key={c}>{c}</li>)}</ul>
        </section>
        <section className="panel span2x">
          <h3>Top 20 {kind} cells <small>{kind === "solar" ? "MW = usable ha / ha per MW" : "MW = developable km2 x MW per km2"}</small></h3>
          <table className="tbl">
            <thead><tr><th>#</th><th>MW</th><th>MWh/yr</th><th>Revenue Rs/yr</th><th>Net Rs/yr</th><th>Grid km (sub / 33 kV)</th><th>Reasons</th></tr></thead>
            <tbody>{top.slice(0, 20).map((t) => (
              <tr key={t.rank}><td className="mono">{t.rank}</td><td className="mono">{t.mw}</td><td className="mono">{f0(t.mwh_yr)}</td>
                <td className="mono"><Rupee v={t.revenue_rs_yr} name={`${kind}.${rsKey}`} meta={meta(rsKey)} value={sp[rsKey]?.v} /></td>
                <td className="mono"><Rupee v={t.net_value_rs_yr} name={`${kind}.net_value`} meta={meta(rsKey)} /></td>
                <td className="mono">{t.grid_km_substation} / {t.grid_km_line33}</td><td className="reasons">{t.reasons.join("; ")}</td></tr>))}</tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
