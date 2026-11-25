import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ViewProps } from "./props";
import { Rupee } from "../Assume";
import { inr, ha as fha } from "../fmt";
import { BeforeAfter, Chip, Num, Skeleton, Stat, ViewHead } from "../ui";

const Ledger3D = lazy(() => import("./Ledger3D"));

const N = 46, MS = 640, V = 5, S = 300, ZK = 3.2; // mosaic px, crop width in chips, crop px
const NEW = new Set(["new_layout", "building_construction"]);
const CAT: Record<string, { label: string; color: string; note: string }> = {
  new_construction: { label: "New construction", color: "#f2a93b", note: "new layout or building; sub-type split is unreliable at 10 m" },
  agri_ambiguous: { label: "Cleared, ambiguous", color: "#6fd3c0", note: "cleared land without a road grid: may be harvested or fallow field" },
  lake_filling_lead: { label: "Lake lead (unconfirmed)", color: "#6aa5e8", note: "0 of 10 confirmed filling at 10 m" },
};
const cat = (c: string) => (NEW.has(c) ? "new_construction" : c);
const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(0)}%`);

interface Site { site?: number; category: string; ha: number; ward: string | null; lat: number; lon: number; buffer_flag: boolean; near_drain?: boolean;
  confidence: number | null; rank: number; built_frac?: number; road_density?: number; n_orientations?: number; lake?: string; lake_acres?: number }

export function Insights({ data }: ViewProps) {
  const R = data.reports;
  const sites: Site[] | undefined = R.sites_blr?.sites;
  const survey = R.survey_blr, lead = R.audit_blr_lead, audit = R.audit_blr, chg = R.change_blr_summary;
  const [show, setShow] = useState<Record<string, boolean>>({ new_construction: true, agri_ambiguous: false, lake_filling_lead: false });
  const [sel, setSel] = useState<Site | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // warm the before/after crops (both are crops of these two mosaics) after first paint
  useEffect(() => { const id = setTimeout(() => (["blr_t0.jpg", "blr_t1.jpg"].forEach((f) => { new Image().src = `/data/img/${f}`; })), 400); return () => clearTimeout(id); }, []);
  const [d3, setD3] = useState(false);
  const [onlyFlag, setOnlyFlag] = useState(false);

  // Georeference from tile-centre extremes (tile order i = row*46+col within blr t1); small UTM rotation ignored.
  const geo = useMemo(() => {
    const t = data.tiles.filter((x) => x.aoi === "blr" && x.date === "t1");
    if (t.length < N * N) return null;
    const a = t[0], b = t[N * N - 1];
    return (lat: number, lon: number): [number, number] => [
      (0.5 + ((lon - a.lon) / (b.lon - a.lon)) * (N - 1)) / N, (0.5 + ((lat - a.lat) / (b.lat - a.lat)) * (N - 1)) / N];
  }, [data.tiles]);

  // mosaic edge rectangle [w, s, e, n] from the same tile-centre extremes (half a tile beyond the outer centres)
  const rect = useMemo((): [number, number, number, number] | null => {
    const t = data.tiles.filter((x) => x.aoi === "blr" && x.date === "t1");
    if (t.length < N * N) return null;
    const a = t[0], b = t[N * N - 1], dl = (b.lon - a.lon) / (N - 1), dt = (b.lat - a.lat) / (N - 1);
    return [a.lon - dl / 2, Math.min(a.lat - dt / 2, b.lat + dt / 2), b.lon + dl / 2, Math.max(a.lat - dt / 2, b.lat + dt / 2)];
  }, [data.tiles]);
  const list = useMemo(() => (sites ?? []).filter((s) => show[cat(s.category)] && (!onlyFlag || s.buffer_flag))
    .sort((a, b) => (cat(a.category) === "new_construction" ? 0 : 1) - (cat(b.category) === "new_construction" ? 0 : 1) || b.ha - a.ha).slice(0, 120), [sites, show, onlyFlag]);

  const items3 = useMemo(() => list.map((x) => ({ rank: x.rank, lat: x.lat, lon: x.lon, ha: x.ha, color: CAT[cat(x.category)].color })), [list]);

  if (!sites || !survey) return <section className="panel"><h3>Insights <small>not generated</small></h3><p className="muted">reports/sites_blr.json and survey_blr.json are missing. Run the change step, then npm run prepare-data.</p></section>;
  const counts = R.sites_blr.category_counts;
  const nc = counts.new_layout.n + counts.building_construction.n;
  const ncHa = counts.new_layout.ha + counts.building_construction.ha;
  const view = sel && geo ? (() => { const [fx, fy] = geo(sel.lat, sel.lon); const c = (f: number) => Math.min(0, Math.max(1 - ZK, 0.5 - f * ZK)); return { k: ZK, x: c(fx), y: c(fy) }; })() : { k: 1, x: 0, y: 0 };
  const pick = (s: Site) => setSel(s);
  const onKeys = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0; if (!d) return;
    e.preventDefault(); const i = Math.max(0, Math.min(list.length - 1, list.indexOf(sel as Site) + d)); pick(list[i]);
    (listRef.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  };
  const crop = (img: string) => {
    if (!sel || !geo) return {};
    const [fx, fy] = geo(sel.lat, sel.lon), bs = S * N / V;
    return { backgroundImage: `url(/data/img/${img})`, backgroundSize: `${bs}px ${bs}px`, backgroundPosition: `${S / 2 - fx * bs}px ${S / 2 - fy * bs}px` };
  };
  const ward = survey.wards_ranked.filter((w: any) => w.new_built_ha > 0).slice(0, 12);
  const rm = { assumption: true, source: survey.rupees_source + " " + survey.rupees_note };

  return (
    <div>
      <ViewHead kicker="Track A, objective 1" title="Bengaluru's construction ledger: every new layout and building, caught the month it starts, checked against no-build zones"
        sub={<>Decision: where enforcement, survey and planning teams go this week. Pair {survey.dates[0].slice(0, 10)} to {survey.dates[1].slice(0, 10)}, Sentinel-2 at 10 m. Leads need ground verification.</>} />
      <div className="stats">
        <Stat label="new-construction leads"><Num v={nc} /></Stat>
        <Stat label="area changed"><Num v={ncHa} f={(x) => fha(x, 0)} /></Stat>
        <Stat label="near lake buffers (KTCDA)"><Num v={R.sites_blr.n_buffer_flagged_sites} /></Stat>
        <Stat label="near drains"><Num v={R.sites_blr.n_near_drain_sites} /></Stat>
      </div>
      <div className="insmain">
        <section className="panel">
          <h3>Map <small>{d3 ? "click a column or a lead" : "click a marker or a lead"}</small><button className={d3 ? "on" : ""} aria-pressed={d3} onClick={() => setD3(!d3)} disabled={!rect}>3D ledger</button></h3>
          <div className="legendrow">
            {Object.entries(CAT).map(([k, c]) => (
              <label key={k} title={c.note}><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /><i style={{ background: c.color }} />{c.label}</label>
            ))}
            <label><input type="checkbox" checked={onlyFlag} onChange={(e) => setOnlyFlag(e.target.checked)} />lake-buffer only</label>
          </div>
          {d3 && rect ? <div className="mosaic"><Suspense fallback={<Skeleton rows={4} label="loading 3D" />}><Ledger3D items={items3} rect={rect} imgUrl="/data/img/blr_t1.jpg" selRank={sel?.rank ?? null} onPick={(r) => { const x = list.find((y) => y.rank === r); if (x) pick(x); }} /></Suspense><span className="hint">column height = changed ha</span></div> :
          <div className="mosaic">
            <div className="zoomer" style={{ transform: `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.k})` }}>
              <img src="/data/img/blr_t1.jpg" alt="Bengaluru north mosaic at t1" width={MS} height={MS} decoding="async" />
              {geo && <svg viewBox={`0 0 ${MS} ${MS}`}>
                {list.map((s) => { const [fx, fy] = geo(s.lat, s.lon); const on = sel === s; const k = view.k;
                  return <g key={s.rank} className="mk" tabIndex={0} role="button" aria-label={`lead rank ${s.rank}, ${s.ha} ha`} onClick={() => pick(s)} onKeyDown={(e) => e.key === "Enter" && pick(s)}>
                    {on && <circle className="pulse" cx={fx * MS} cy={fy * MS} r={9 / k} fill="none" stroke="#f2a93b" strokeWidth={1.5 / k} />}
                    <circle cx={fx * MS} cy={fy * MS} r={(on ? 6 : 3 + Math.min(4, Math.sqrt(s.ha) / 2)) / (k > 1 ? k * 0.75 : 1)} fill={CAT[cat(s.category)].color} fillOpacity={0.6}
                      stroke={on ? "#fff" : s.buffer_flag ? "#e5694f" : "#000"} strokeWidth={(on ? 2 : 1) / k} /></g>; })}
              </svg>}
            </div>
            {view.k > 1 && <button className="reset" onClick={() => setSel(null)}>reset view</button>}
          </div>}
          <p className="muted small">Red outline = within a lake buffer. Marker position is derived from tile-centre extremes; expect a few tens of metres of error.</p>
        </section>

        <div className="rightcol">
          <section className="panel leadpanel">
            <h3>Ranked leads <small>{list.length} shown, largest first</small></h3>
            <div className="leads" role="listbox" aria-label="ranked leads" tabIndex={0} onKeyDown={onKeys} ref={listRef}>
              {list.map((s, i) => (
                <button key={s.rank} tabIndex={-1} className={sel === s ? "on" : ""} onClick={() => pick(s)} role="option" aria-selected={sel === s}>
                  <span className="mono dim">{i + 1}</span><i style={{ background: CAT[cat(s.category)].color }} /><span className="trunc">{CAT[cat(s.category)].label}</span>
                  <span className="mono r">{s.ha.toFixed(1)} ha</span><span className="trunc dim">{s.ward ?? "-"}</span>{s.buffer_flag ? <Chip tone="bad">lake buffer</Chip> : <span />}
                </button>
              ))}
            </div>
          </section>
          <section className="panel detail">
            {!sel ? <div className="empty"><b>Select a lead</b><span>The map zooms to it and opens a before and after slider. Drag the handle or use the arrow keys.</span></div> : (
              <div className="detailrow" key={sel.rank}>
                <BeforeAfter before={crop("blr_t0.jpg")} after={crop("blr_t1.jpg")} size={S} labels={["2023-02", "2025-02"]} />
                <dl className="dl">
                  <dt>category</dt><dd>{CAT[cat(sel.category)].label}{NEW.has(sel.category) && <small> (hint: {sel.category === "new_layout" ? "layout" : "building"})</small>}</dd>
                  <dt>area</dt><dd className="mono">{fha(sel.ha, 2)}</dd>
                  <dt>ward</dt><dd>{sel.ward ?? "n/a"}</dd>
                  <dt>position</dt><dd className="mono">{sel.lat.toFixed(5)}, {sel.lon.toFixed(5)}</dd>
                  <dt>confidence</dt><dd className="mono">{pct(sel.confidence)} <small>audit precision</small></dd>
                  <dt>flags</dt><dd>{[sel.buffer_flag && "lake buffer", sel.near_drain && "near drain"].filter(Boolean).join(", ") || "none"}</dd>
                  {sel.built_frac !== undefined && <><dt>built / roads</dt><dd className="mono">{sel.built_frac} / {sel.road_density}</dd></>}
                  {sel.lake && <><dt>lake</dt><dd>{sel.lake} ({sel.lake_acres} acres)</dd></>}
                </dl>
              </div>)}
          </section>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="panel">
          <h3>Honesty panel <small>reviewer audit, not field-verified</small></h3>
          <dl className="dl">
            {lead && <><dt>Lead precision</dt><dd className="mono">{lead.precision.toFixed(2)} <small>({lead.real} real, {lead.wrong} wrong, {lead.unsure} unsure of {lead.n}); {lead.precision_excl_unsure.toFixed(2)} excl. unsure</small></dd></>}
            {chg && <><dt>Injected-patch recall</dt><dd className="mono">{Object.entries(chg.validation.injected.recall_by_size).map(([k, v]) => `${k} ha: ${pct(v as number)}`).join(", ")}</dd>
              <dt>OSM construction P / R</dt><dd className="mono">{chg.validation.osm.precision.toFixed(2)} / {chg.validation.osm.recall.toFixed(2)} <small>held-out half; OSM is sparse, precision understated</small></dd></>}
            {lead?.lake_leads && <><dt>Lake leads</dt><dd>{lead.lake_leads.n} flagged, {lead.lake_leads.confirmed_filling} confirmed filling: dry-season drying and desilting works. {lead.lake_leads.finding}</dd></>}
            {audit && <><dt>Per-category precision</dt><dd className="mono">{Object.entries(audit.per_category).map(([k, v]: any) => `${k} ${v.precision.toFixed(2)}`).join(" / ")}</dd></>}
          </dl>
          {chg && <p className="muted small">{chg.validation.caveat}</p>}
          <p className="muted small">{R.sites_blr.rainfall_caveat}</p>
        </section>

        <section className="panel">
          <h3>Wards <small>top by new built-up area</small></h3>
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Ward</th><th className="r">New built ha</th><th className="r">Cleared ha</th><th className="r">Growth</th><th className="r">Conf.</th><th className="r">Expected</th></tr></thead>
            <tbody>{ward.map((w: any) => (
              <tr key={w.ward_id}><td>{w.ward}</td><td className="mono r">{w.new_built_ha.toFixed(1)}</td><td className="mono r">{w.cleared_ha.toFixed(1)}</td>
                <td className="mono r">{w.growth_pct.toFixed(1)}%</td><td className="mono r">{pct(w.confidence)}</td>
                <td className="mono r nw"><Rupee v={w.rupees_expected} name="rupees_per_ha.A" meta={rm} value={survey.rupees_per_ha_A} /></td></tr>))}</tbody>
          </table></div>
          <p className="muted small">Expected = new built ha x {inr(survey.rupees_per_ha_A)}/ha x confidence (assumption). {survey.aoi_summary.growth_caveat}</p>
        </section>
      </div>
    </div>
  );
}
