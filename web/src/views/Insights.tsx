import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ViewProps } from "./props";
import { Rupee } from "../Assume";
import { inr, ha as fha } from "../fmt";
import { Chip, Skeleton, ViewHead, Guard } from "../ui";
import { Empty, Histogram, HBars, Info, Kpi, useSort } from "../kit";
import { explain } from "../explain";
import { aoiGeo } from "../geo";
import { SiteDrawer, type SiteRef } from "../SiteDetail";
import { useJson } from "../useJson";
import { createPortal } from "react-dom";
import { WorkPanel } from "../WorkPanel";
import { PanZoom } from "../PanZoom";
import { BarChart } from "../charts";
import { applyPatch, countStatus, download, LEAD_KEY, LEAD_STATUS, statusOf, toCSV, toGeoJSON, toKML, useLocal, type WorkStore } from "../work";

const Ledger3D = lazy(() => import("./Ledger3D"));

const N = 46, MS = 640;
const NEW = new Set(["new_layout", "building_construction"]);
const CAT: Record<string, { label: string; color: string; note: string }> = {
  new_construction: { label: "New construction", color: "#F5A524", note: "new layout or building; sub-type split is unreliable at 10 m" },
  agri_ambiguous: { label: "Cleared, ambiguous", color: "#8A97A8", note: "cleared land without a road grid: may be harvested or fallow field" },
  lake_filling_lead: { label: "Lake lead (unconfirmed)", color: "#22D3EE", note: "OSM lake water lost between the dates; 0 of 10 confirmed filling at 10 m" },
};
const cat = (c: string) => (NEW.has(c) ? "new_construction" : c in CAT ? c : "agri_ambiguous"); // unknown categories fall back instead of crashing
const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(0)}%`);
const EDGES = [0.25, 0.5, 1, 2, 5, 10, 25, Infinity];

interface Site { site?: number; osm_id?: number; category: string; ha: number; ward: string | null; lat: number; lon: number; buffer_flag: boolean; near_drain?: boolean;
  confidence: number | null; rank: number; built_frac?: number; road_density?: number; n_orientations?: number; lake?: string; lake_acres?: number;
  stage_info?: Record<string, string>; water_t0_ha?: number; water_t1_ha?: number; lost_to_bare_ha?: number; lost_to_veg_ha?: number; lost_to_built_ha?: number; cropland_chip?: number }
type Row = Site & { id: string; cname: string; wardn: string; crop: boolean; prio: number; status: string };
const sid = (s: Site) => (s.category === "lake_filling_lead" ? `blr_lake${s.osm_id}` : `blr_site${s.site}`);

export function Insights({ data }: ViewProps) {
  const R = data.reports;
  const sites: Site[] | undefined = R.sites_blr?.sites;
  const survey = R.survey_blr, lead = R.audit_blr_lead, audit = R.audit_blr, chg = R.change_blr_summary;
  const idx = useJson<Record<string, any>>("sites_index.json");
  const [show, setShow] = useState<Record<string, boolean>>({ new_construction: true, agri_ambiguous: false, lake_filling_lead: true });
  const [sel, setSel] = useState<Row | null>(null);
  const [onlyFlag, setOnlyFlag] = useState(false), [ward, setWard] = useState(""), [minHa, setMinHa] = useState(0), [minConf, setMinConf] = useState(0), [cropOnly, setCropOnly] = useState(false);
  const [bin, setBin] = useState<number | null>(null), [limit, setLimit] = useState(25);
  const [work, setWork] = useLocal<WorkStore>(LEAD_KEY, {});
  const [stF, setStF] = useState(""), [picked, setPicked] = useState<Set<string>>(new Set()), [printing, setPrinting] = useState(false);
  const [d3, setD3] = useState(false), [wTab, setWTab] = useState(false);
  useEffect(() => { const id = setTimeout(() => { new Image().src = "/data/img/blr_t1.jpg"; }, 400); return () => clearTimeout(id); }, []);
  const geo = useMemo(() => aoiGeo(data.tiles, "blr"), [data.tiles]);
  const rect = useMemo((): [number, number, number, number] | null => {
    const t = data.tiles.filter((x) => x.aoi === "blr" && x.date === "t1");
    if (t.length < N * N) return null;
    const a = t[0], b = t[N * N - 1], dl = (b.lon - a.lon) / (N - 1), dt = (b.lat - a.lat) / (N - 1);
    return [a.lon - dl / 2, Math.min(a.lat - dt / 2, b.lat + dt / 2), b.lon + dl / 2, Math.max(a.lat - dt / 2, b.lat + dt / 2)];
  }, [data.tiles]);
  const all: Row[] = useMemo(() => (sites ?? []).map((s) => ({ ...s, id: sid(s), cname: CAT[cat(s.category)].label, wardn: s.ward ?? "Outside BBMP / none", crop: !!idx?.[sid(s)], prio: s.ha * (s.confidence ?? 0), status: "new" })), [sites, idx]);
  const wards = useMemo(() => [...new Set(all.map((s) => s.wardn))].sort(), [all]);
  const allW = useMemo(() => all.map((s) => ({ ...s, status: statusOf(work, s.id) })), [all, work]);
  const list = useMemo(() => allW.filter((s) => show[cat(s.category)] && (!onlyFlag || s.buffer_flag) && (!ward || s.wardn === ward) && s.ha >= minHa && (s.confidence ?? 0) >= minConf
    && (!cropOnly || s.crop) && (!stF || s.status === stF) && (bin == null || (s.ha >= EDGES[bin] && s.ha < EDGES[bin + 1]))), [allW, show, onlyFlag, ward, minHa, minConf, cropOnly, bin, stF]);
  const { sorted, th } = useSort(list, "prio");
  useEffect(() => setLimit(25), [list]);
  const items3 = useMemo(() => list.slice(0, 150).map((x) => ({ rank: x.rank, lat: x.lat, lon: x.lon, ha: x.ha, color: CAT[cat(x.category)].color })), [list]);
  const byWard = useMemo(() => { const m = new Map<string, number>(); for (const s of list) m.set(s.wardn, (m.get(s.wardn) ?? 0) + s.ha); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, v]) => ({ label, v })); }, [list]);
  const byCat = useMemo(() => Object.keys(CAT).map((k) => ({ label: CAT[k].label, v: list.filter((s) => cat(s.category) === k).reduce((a, s) => a + s.ha, 0) })).filter((x) => x.v > 0), [list]);

  if (!sites || !survey) return <section className="panel"><h3>Construction ledger <small>not generated</small></h3><p className="muted">reports/sites_blr.json and survey_blr.json are missing. Run the change step, then npm run prepare-data.</p></section>;
  const counts = R.sites_blr.category_counts;
  const nc = counts.new_layout.n + counts.building_construction.n;
  const ncHa = counts.new_layout.ha + counts.building_construction.ha;
  const rm = { assumption: true, source: survey.rupees_source + " " + survey.rupees_note };
  const wardRows = survey.wards_ranked.filter((w: any) => w.new_built_ha > 0).slice(0, 12);
  const stCount = countStatus(work, all.filter((s) => show[cat(s.category)]).map((s) => s.id), LEAD_STATUS);
  const ids = [...picked].filter((i) => list.some((r) => r.id === i));
  const setMany = (idl: string[], patch: Partial<{ status: string; note: string; assignee: string }>) => setWork((w) => applyPatch(w, idl, patch));
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const rowsOut = () => sorted.map((r) => ({ id: r.id, rank: r.rank, status: statusOf(work, r.id), assignee: work[r.id]?.assignee ?? "", note: work[r.id]?.note ?? "", ward: r.wardn, category: r.category, ha: r.ha, confidence: r.confidence ?? "", priority: +r.prio.toFixed(2),
    lat: r.lat, lon: r.lon, lake_buffer: r.buffer_flag, near_drain: !!r.near_drain, crop_before: idx?.[r.id]?.files?.t0 ?? "", crop_after: idx?.[r.id]?.files?.t1 ?? "" }));
  const pts = () => rowsOut().map((r) => ({ lat: r.lat, lon: r.lon, name: `${r.id} ${r.category} ${r.ha} ha`, props: { status: r.status, assignee: r.assignee, ward: r.ward, ha: r.ha, confidence: r.confidence, lake_buffer: r.lake_buffer, note: r.note } }));
  const exCSV = () => download("herald_lead_queue.csv", "text/csv", toCSV(rowsOut(), ["id", "rank", "status", "assignee", "note", "ward", "category", "ha", "confidence", "priority", "lat", "lon", "lake_buffer", "near_drain", "crop_before", "crop_after"]));
  const exGeo = () => download("herald_lead_queue.geojson", "application/geo+json", JSON.stringify(toGeoJSON(pts()), null, 1));
  const exKml = () => download("herald_lead_queue.kml", "application/vnd.google-earth.kml+xml", toKML(pts(), "HERALD lead queue"));
  const doPrint = () => { setPrinting(true); document.body.classList.add("printing"); const done = () => { document.body.classList.remove("printing"); setPrinting(false); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done); setTimeout(() => window.print(), 300); };
  const reset = () => { setStF("");  setWard(""); setMinHa(0); setMinConf(0); setOnlyFlag(false); setCropOnly(false); setBin(null); setShow({ new_construction: true, agri_ambiguous: false, lake_filling_lead: true }); };
  const filtered = stF || ward || minHa || minConf || onlyFlag || cropOnly || bin != null;
  const ref: SiteRef | null = sel && {
    id: sel.id, aoi: "blr", lat: sel.lat, lon: sel.lon, title: `${sel.cname}, ${fha(sel.ha, 1)}${sel.ward ? `, ${sel.ward}` : ""}`,
    facts: [
      { k: "Category", v: <>{sel.cname}{NEW.has(sel.category) && <small> (sub-type hint: {sel.category === "new_layout" ? "layout" : "building"})</small>}</>,
        why: <>{R.sites_blr.category_def?.[sel.category] ?? sel.category}. {CAT[cat(sel.category)].note}.</> },
      { k: "Area", v: <span className="mono">{fha(sel.ha, 2)}</span>, why: <>Changed pixels x 0.01 ha (a 10 m pixel is 100 m2). Sites below {R.sites_blr.min_site_ha} ha are not listed.</> },
      { k: "Ward", v: sel.ward ?? "Outside BBMP", why: <>Point-in-polygon against the BBMP ward boundaries from OSM. Peri-urban land outside the corporation has no ward.</> },
      { k: "Confidence", v: <span className="mono">{pct(sel.confidence)}</span>, why: <>{R.sites_blr.confidence_def}. It is the category's reviewer-audit precision, the same for every site in that category; it is not a per-site probability.</> },
      ...(sel.built_frac !== undefined ? [{ k: "Built fraction", v: <span className="mono">{sel.built_frac}</span>, why: <>Share of changed pixels that look built (NDBI above 0 and BSI under 0.15). A building needs at least 0.4.</> }] : []),
      ...(sel.road_density !== undefined ? [{ k: "Road-line density", v: <span className="mono">{sel.road_density} in {sel.n_orientations} directions</span>, why: <>Thin bright lines (new roads) per site pixel. A layout needs at least 0.03, in at least 2 directions that each hold 15% of the line pixels.</> }] : []),
      ...(sel.lake ? [{ k: "Lake", v: <>{sel.lake}, {sel.lake_acres} acres</>, why: <>OSM water polygon. Water area t0 {sel.water_t0_ha} ha, t1 {sel.water_t1_ha} ha; lost to bare {sel.lost_to_bare_ha} ha, to vegetation {sel.lost_to_veg_ha} ha.</> }] : []),
      { k: "Flags", v: [sel.buffer_flag && "lake buffer", sel.near_drain && "near drain"].filter(Boolean).join(", ") || "none", why: <>Lake buffer: inside the KTCDA no-build tier for that lake size. Drain: within reach of an OSM drain. Both are "possible, verify on ground", never a legal finding at 10 m.</> },
      ...(sel.stage_info ? [{ k: "Stage by date", v: <span className="mono small">{Object.entries(sel.stage_info).map(([k, v]) => `${k}: ${v}`).join(", ")}</span>, why: <>Land stage per scene: cleared, built or no_data (cloud). It tells you whether the clearing at t1 is followed by construction.</> }] : []),
      { k: "Decision", v: <>Send to the ward revenue officer or lake authority for a ground check; if the plot is not on the roll, add it to the assessment survey.</>, why: <>Expected value for the city: area x {inr(survey.rupees_per_ha_A)}/ha x confidence (assumption).</> },
    ],
    actions: <WorkPanel w={work[sel.id]} options={LEAD_STATUS} who="Lead" onChange={(p) => setMany([sel.id], p)} />,
    fallback: sel.crop ? undefined : ["Native-resolution crops are generated for the 120 largest construction leads and the lake leads. This lead is not in that set."],
  };
  return (
    <div>
      <ViewHead explain={explain("ledger", data)} kicker="Track A" title="Construction ledger" sub={<span className="chip">{survey.dates[0].slice(0, 10)} to {survey.dates[1].slice(0, 10)}, Sentinel-2 10 m</span>} />
      <div className="kgrid k4">
        <Kpi label="New-construction leads" value={nc} tone="acc" sub={`audit precision ${lead ? lead.precision_excl_unsure.toFixed(2) : "n/a"} excl. unsure`} info={<>New-layout plus building sites of at least {R.sites_blr.min_site_ha} ha. Precision from the reviewer audit of {lead?.n} leads ({lead?.real} real, {lead?.wrong} wrong, {lead?.unsure} unsure); {lead?.precision?.toFixed(2)} if unsure counts as wrong.</>} />
        <Kpi label="Area changed" value={fha(ncHa, 0)} sub="new construction, two years" info={<>Sum of site areas for the two construction categories. Each 10 m pixel is 0.01 ha.</>} />
        <Kpi label="Near lake buffers" value={R.sites_blr.n_buffer_flagged_sites} sub="KTCDA no-build tiers" info={<>Construction sites inside the buffer tier for the lake's size (Supreme Court 5 Mar 2019 restored the 30 m RMP-2015 buffer; KTCDA 2025 tiers by lake size). Possible encroachment, verify on ground.</>} />
        <Kpi label="Near drains" value={R.sites_blr.n_near_drain_sites} sub="OSM drains" info={<>Construction sites near a mapped storm-water drain (flood-risk flag). OSM drains are incomplete.</>} />
      </div>

      <div className="stcards" role="group" aria-label="Queue by status">
        {LEAD_STATUS.map((o) => (
          <button key={o.id} className={`stcard ${stF === o.id ? "on" : ""}`} aria-pressed={stF === o.id} onClick={() => setStF(stF === o.id ? "" : o.id)}>
            <b>{stCount[o.id]}</b><span>{o.label}</span></button>))}
      </div>

      <section className="panel filters" aria-label="Filters">
        <div className="frow">
          <fieldset><legend>Category</legend>
            {Object.entries(CAT).map(([k, c]) => (
              <label key={k} title={c.note} className="fchk"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /><i style={{ background: c.color }} />{c.label}</label>))}
          </fieldset>
          <label className="fsel">Ward<select value={ward} onChange={(e) => setWard(e.target.value)}><option value="">All wards</option>{wards.map((w) => <option key={w}>{w}</option>)}</select></label>
          <label className="fsel">Size<select value={minHa} onChange={(e) => setMinHa(+e.target.value)}>{[0, 1, 2, 5, 10].map((v) => <option key={v} value={v}>{v ? `at least ${v} ha` : "any size"}</option>)}</select></label>
          <label className="fsel">Confidence<select value={minConf} onChange={(e) => setMinConf(+e.target.value)}>{[0, 0.4, 0.6, 0.8].map((v) => <option key={v} value={v}>{v ? `at least ${v}` : "any"}</option>)}</select></label>
          <label className="fchk"><input type="checkbox" checked={onlyFlag} onChange={(e) => setOnlyFlag(e.target.checked)} />Lake buffer only</label>
          <label className="fchk"><input type="checkbox" checked={cropOnly} onChange={(e) => setCropOnly(e.target.checked)} />Has 10 m crop</label>
          <span className="fcount mono">{list.length} of {all.length}</span>
          <button onClick={reset} disabled={!filtered && !show.agri_ambiguous}>Reset</button>
        </div>
      </section>

      <div className="insmain">
        <section className="panel">
          <h3>Map <small>{d3 ? "click a column" : "click a marker"}</small><button className={d3 ? "on" : ""} aria-pressed={d3} onClick={() => setD3(!d3)} disabled={!rect}>3D ledger</button></h3>
          {d3 && rect ? <div className="mosaic"><Guard label="3D ledger"><Suspense fallback={<Skeleton rows={4} label="loading 3D" />}><Ledger3D items={items3} rect={rect} imgUrl="/data/img/blr_t1.jpg" selRank={sel?.rank ?? null} onPick={(r) => { const x = list.find((y) => y.rank === r); if (x) setSel(x); }} /></Suspense></Guard></div> : (
            <PanZoom>{(k) => (<>
              <img src="/data/img/blr_t1.jpg" alt="Bengaluru north mosaic at t1" width={MS} height={MS} decoding="async" draggable={false} />
              {geo && <svg viewBox={`0 0 ${MS} ${MS}`}>
                {list.slice(0, 600).map((s) => { const [fx, fy] = geo(s.lat, s.lon); const on = sel === s;
                  return <g key={s.rank} className="mk" tabIndex={0} role="button" aria-label={`${s.cname}, ${s.ha} ha`} onClick={() => setSel(s)} onKeyDown={(e) => e.key === "Enter" && setSel(s)}>
                    <circle cx={fx * MS} cy={fy * MS} r={(on ? 7 : 3 + Math.min(4, Math.sqrt(s.ha) / 2)) / Math.sqrt(k)} fill={CAT[cat(s.category)].color} fillOpacity={0.7} stroke={on ? "#fff" : s.buffer_flag ? "#F87171" : "#0A0E14"} strokeWidth={(on ? 2 : 1) / k} /></g>; })}
              </svg>}</>)}</PanZoom>)}
        </section>
        <div className="rightcol">
          <section className="panel">
            <h3>Lead size <small>click a bar to filter</small><Info title="Lead size histogram">Count of leads per area bin (ha) after the filters above. Most leads are small; a few large layouts hold most of the area. Clicking a bar filters the table to that bin.</Info></h3>
            <Histogram values={all.filter((s) => show[cat(s.category)]).map((s) => s.ha)} edges={EDGES} unit="ha" hi={bin} onBin={(i) => setBin(bin === i ? null : i)} />
            {bin != null && <button className="lnk" onClick={() => setBin(null)}>clear bin filter</button>}
          </section>
          <section className="panel">
            <h3>Area by ward <small>click a bar to filter the queue</small><Info title="Area by ward">Sum of lead area per BBMP ward for the leads that match the filters. This is the ranking a revenue officer would work from.</Info></h3>
            {byWard.length ? <BarChart unit=" ha" series={[{ name: "ha", color: "#F5A524" }]} rows={byWard.map((w) => ({ key: w.label, label: w.label, vals: [w.v] }))} active={ward} onPick={(k) => setWard(ward === k ? "" : k)} /> : <Empty title="No leads match" />}
          </section>
          <section className="panel">
            <h3>Area by category <small>filtered leads</small></h3>
            {byCat.length ? <BarChart unit=" ha" series={[{ name: "ha", color: "#8A97A8" }]} rows={byCat.map((c) => ({ key: c.label, label: c.label, vals: [c.v] }))} /> : <Empty title="No leads match" />}
          </section>
        </div>
      </div>

      <section className="panel">
        <h3>Work queue <small>priority = area x confidence; click a row for the detail and actions</small>
          <span className="btns"><button onClick={exCSV} disabled={!list.length}>CSV</button><button onClick={exGeo} disabled={!list.length}>GeoJSON</button><button onClick={exKml} disabled={!list.length}>KML</button><button onClick={doPrint} disabled={!list.length}>Print inspection sheet</button></span></h3>
        <div className="bulk" aria-live="polite"><span>{ids.length} selected</span>
          <button onClick={() => setPicked(new Set(sorted.slice(0, limit).map((r) => r.id)))} disabled={!list.length}>Select shown</button>
          <button onClick={() => setPicked(new Set())} disabled={!picked.size}>Clear</button><span className="sp" />
          <span className="dim">Set selected to</span>{LEAD_STATUS.map((o) => <button key={o.id} disabled={!ids.length} onClick={() => setMany(ids, { status: o.id })}>{o.label}</button>)}</div>
        {list.length === 0 ? <Empty title="No leads match these filters">Widen the size or confidence filters, or press Reset.</Empty> : <>
          <div className="tblwrap"><table className="tbl rows">
            <thead><tr><th><span className="sr">Select</span></th>{th("rank", "#")}{th("status", "Status", false)}{th("cname", "Category", false)}{th("ha", "Area (ha)")}{th("wardn", "Ward", false)}{th("prio", "Priority")}{th("confidence", "Conf.")}{th("buffer_flag", "Lake buffer", false)}{th("crop", "10 m crop", false)}</tr></thead>
            <tbody>{sorted.slice(0, limit).map((s) => (
              <tr key={s.id + s.rank} tabIndex={0} className={sel === s ? "on" : ""} onClick={() => setSel(s)} onKeyDown={(e) => e.key === "Enter" && setSel(s)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${s.id}`} checked={picked.has(s.id)} onChange={() => togglePick(s.id)} /></td><td className="mono r">{s.rank}</td><td><span className={`stl ${s.status}`}>{LEAD_STATUS.find((o) => o.id === s.status)?.label.split(" (")[0]}</span></td><td><i className="dot" style={{ background: CAT[cat(s.category)].color }} />{s.cname}</td><td className="mono r">{s.ha.toFixed(1)}</td>
                <td className="trunc">{s.wardn}</td><td className="mono r">{s.prio.toFixed(1)}</td><td className="mono r">{pct(s.confidence)}</td><td>{s.buffer_flag ? <Chip tone="bad">lake buffer</Chip> : ""}</td><td className="dim">{s.crop ? "yes" : "no"}</td></tr>))}</tbody>
          </table></div>
          {limit < sorted.length && <button className="more" onClick={() => setLimit(limit + 50)}>Show 50 more ({sorted.length - limit} left)</button>}
        </>}
      </section>

      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="panel">
          <details className="how"><summary>Honesty panel <small className="dim">reviewer audit, not field-verified</small></summary>
          <dl className="dl">
            {lead && <><dt>Lead precision</dt><dd className="mono">{lead.precision.toFixed(2)} <small>({lead.real} real, {lead.wrong} wrong, {lead.unsure} unsure of {lead.n}); {lead.precision_excl_unsure.toFixed(2)} excl. unsure</small></dd></>}
            {chg && <><dt>Injected-patch recall</dt><dd className="mono">{Object.entries(chg.validation.injected.recall_by_size).map(([k, v]) => `${k} ha: ${pct(v as number)}`).join(", ")}</dd>
              <dt>OSM construction P / R</dt><dd className="mono">{chg.validation.osm.precision.toFixed(2)} / {chg.validation.osm.recall.toFixed(2)} <small>held-out half; OSM is sparse, precision understated</small></dd></>}
            {lead?.lake_leads && <><dt>Lake leads</dt><dd>{lead.lake_leads.n} flagged, {lead.lake_leads.confirmed_filling} confirmed filling: dry-season drying and desilting works. {lead.lake_leads.finding}</dd></>}
            {audit && <><dt>Sub-type split</dt><dd className="mono">{Object.entries(audit.per_category).map(([k, v]: any) => `${k} ${v.precision.toFixed(2)}`).join(" / ")} <span className="dim">(strict: layout vs building at 10 m is unreliable, so leads are scored as one "new construction" class above)</span></dd></>}
          </dl>
          {chg && <p className="muted small">{chg.validation.caveat}</p>}
          <p className="muted small">{R.sites_blr.rainfall_caveat}</p>
        </details>
        </section>
        <section className="panel">
          <h3>Wards <small>top by new built-up area</small><button className={wTab ? "on" : ""} aria-pressed={wTab} onClick={() => setWTab(!wTab)}>{wTab ? "Show chart" : "Show table"}</button></h3>
          {!wTab && <BarChart unit=" ha" series={[{ name: "New built ha", color: "#F5A524" }, { name: "Cleared ha", color: "#8A97A8" }]} rows={wardRows.map((w: any) => ({ key: w.ward_id, label: w.ward, vals: [w.new_built_ha, w.cleared_ha], note: `growth ${w.growth_pct.toFixed(1)}%, confidence ${pct(w.confidence)}` }))} active={ward} onPick={(k) => { const w = wardRows.find((x: any) => x.ward_id === k); if (w) setWard(ward === w.ward ? "" : w.ward); }} />}
          {wTab && <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Ward</th><th className="r">New built ha</th><th className="r">Cleared ha</th><th className="r">Growth</th><th className="r">Conf.</th><th className="r">Expected</th></tr></thead>
            <tbody>{wardRows.map((w: any) => (
              <tr key={w.ward_id}><td>{w.ward}</td><td className="mono r">{w.new_built_ha.toFixed(1)}</td><td className="mono r">{w.cleared_ha.toFixed(1)}</td>
                <td className="mono r">{w.growth_pct.toFixed(1)}%</td><td className="mono r">{pct(w.confidence)}</td>
                <td className="mono r nw"><Rupee v={w.rupees_expected} name="rupees_per_ha.A" meta={rm} value={survey.rupees_per_ha_A} /></td></tr>))}</tbody>
          </table></div>}
        </section>
      </div>
      {printing && createPortal(<div className="printsheet"><h2 className="ps-h">Inspection sheet: {sorted.length > 40 ? "first 40 of " + sorted.length : sorted.length} leads, printed {new Date().toLocaleDateString()}</h2>
        {sorted.slice(0, 40).map((r) => (<div className="ps-item" key={r.id}>
          {idx?.[r.id] ? <><img src={`/data/${idx[r.id].files.t0}`} alt="before" /><img src={`/data/${idx[r.id].files.t1}`} alt="after" /></> : <><span /><span /></>}
          <div><h4>{r.id}, {r.cname}, {r.ha.toFixed(1)} ha</h4><p>Ward: {r.wardn}. Lat/lon {r.lat.toFixed(5)}, {r.lon.toFixed(5)}. Confidence {pct(r.confidence)}. {r.buffer_flag ? "Inside lake buffer. " : ""}Status: {r.status}.</p>
            <p>Left: {idx?.[r.id]?.dates?.t0 ?? "t0"}. Right: {idx?.[r.id]?.dates?.t1 ?? "t1"}. 10 m pixels, one square = 10 m.</p>
            <p>Visited<span className="ps-box" />Construction present<span className="ps-box" />Approved plan seen<span className="ps-box" />Notice issued<span className="ps-box" /></p>
            <p>Inspector: ______________ Date: __________ Remarks: ______________________________</p></div></div>))}</div>, document.body)}
      {ref && <SiteDrawer key={ref.id + sel!.rank} site={ref} data={data} onClose={() => setSel(null)} />}
    </div>
  );
}
