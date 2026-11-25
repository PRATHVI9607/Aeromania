import { useMemo, useState } from "react";
import type { ViewProps } from "./props";
import { Rupee } from "../Assume";
import { inr } from "../fmt";

const N = 46, MS = 640, V = 5, S = 260; // mosaic px, crop width in chips, crop px
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
  const [split, setSplit] = useState(50);
  const [onlyFlag, setOnlyFlag] = useState(false);

  // Georeference from tile-centre extremes (tile order i = row*46+col within blr t1); small UTM rotation ignored.
  const geo = useMemo(() => {
    const t = data.tiles.filter((x) => x.aoi === "blr" && x.date === "t1");
    if (t.length < N * N) return null;
    const a = t[0], b = t[N * N - 1];
    return (lat: number, lon: number): [number, number] => [
      (0.5 + ((lon - a.lon) / (b.lon - a.lon)) * (N - 1)) / N, (0.5 + ((lat - a.lat) / (b.lat - a.lat)) * (N - 1)) / N];
  }, [data.tiles]);

  const list = useMemo(() => (sites ?? []).filter((s) => show[cat(s.category)] && (!onlyFlag || s.buffer_flag))
    .sort((a, b) => (cat(a.category) === "new_construction" ? 0 : 1) - (cat(b.category) === "new_construction" ? 0 : 1) || b.ha - a.ha).slice(0, 120), [sites, show, onlyFlag]);

  if (!sites || !survey) return <section className="panel"><h3>Insights <small>not generated</small></h3><p className="muted">reports/sites_blr.json and survey_blr.json are missing. Run the change step, then npm run prepare-data.</p></section>;
  const counts = R.sites_blr.category_counts;
  const nc = counts.new_layout.n + counts.building_construction.n;
  const ncHa = counts.new_layout.ha + counts.building_construction.ha;
  const crop = (img: string) => {
    if (!sel || !geo) return {};
    const [fx, fy] = geo(sel.lat, sel.lon), bs = S * N / V;
    return { backgroundImage: `url(/data/img/${img})`, backgroundSize: `${bs}px ${bs}px`, backgroundPosition: `${S / 2 - fx * bs}px ${S / 2 - fy * bs}px` };
  };
  const ward = survey.wards_ranked.filter((w: any) => w.new_built_ha > 0).slice(0, 12);
  const rm = { assumption: true, source: survey.rupees_source + " " + survey.rupees_note };

  return (
    <div className="ins">
      <div className="kicker">Track A, objective 1</div>
      <h2 className="headline">Bengaluru's construction ledger: every new layout and building, caught the month it starts, checked against no-build zones</h2>
      <p className="muted">Pair {survey.dates[0].slice(0, 10)} to {survey.dates[1].slice(0, 10)} (Sentinel-2, 10 m). {nc} new-construction leads covering {ncHa.toFixed(0)} ha; {R.sites_blr.n_buffer_flagged_sites} sites flagged near lake buffers (KTCDA tiers), {R.sites_blr.n_near_drain_sites} near drains. Leads need ground verification.</p>
      <div className="insgrid">
        <section className="panel">
          <h3>Map <small>click a marker</small></h3>
          <div className="legendrow">
            {Object.entries(CAT).map(([k, c]) => (
              <label key={k} title={c.note}><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /><i style={{ background: c.color }} />{c.label}</label>
            ))}
            <label><input type="checkbox" checked={onlyFlag} onChange={(e) => setOnlyFlag(e.target.checked)} />lake-buffer flagged only</label>
          </div>
          <div className="mosaic" style={{ width: MS, height: MS }}>
            <img src="/data/img/blr_t1.jpg" alt="Bengaluru north mosaic at t1" width={MS} height={MS} />
            {geo && <svg viewBox={`0 0 ${MS} ${MS}`} width={MS} height={MS}>
              {list.map((s) => { const [fx, fy] = geo(s.lat, s.lon); const on = sel === s;
                return <circle key={s.rank} cx={fx * MS} cy={fy * MS} r={on ? 7 : 3 + Math.min(4, Math.sqrt(s.ha) / 2)} fill={CAT[cat(s.category)].color} fillOpacity={0.55} stroke={on ? "#fff" : s.buffer_flag ? "#e5694f" : "#000"} strokeWidth={on ? 2 : 1}
                  tabIndex={0} role="button" aria-label={`lead rank ${s.rank}, ${s.ha} ha`} onClick={() => setSel(s)} onKeyDown={(e) => e.key === "Enter" && setSel(s)} style={{ cursor: "pointer" }} />; })}
            </svg>}
          </div>
          <p className="muted">Red outline = within a lake buffer. Marker position is derived from tile-centre extremes; expect a few tens of metres of error.</p>
        </section>

        <section className="panel">
          <h3>Lead <small>{sel ? `rank ${sel.rank}` : "select a lead"}</small></h3>
          {sel && <>
            <div className="ba" style={{ width: S, height: S }}>
              <div className="crop" style={crop("blr_t0.jpg")} />
              <div className="ov" style={{ clipPath: `inset(0 0 0 ${split}%)` }}><div className="crop" style={crop("blr_t1.jpg")} /></div>
              <i className="handle" style={{ left: `${split}%` }} />
            </div>
            <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} aria-label="before after slider" style={{ width: S }} />
            <div className="cap" style={{ width: S }}><span>t0 2023-02</span><span>t1 2025-02</span></div>
            <dl className="dl">
              <dt>category</dt><dd>{CAT[cat(sel.category)].label}{NEW.has(sel.category) && <small> (hint: {sel.category === "new_layout" ? "layout" : "building"})</small>}</dd>
              <dt>area</dt><dd className="mono">{sel.ha.toFixed(2)} ha</dd>
              <dt>ward</dt><dd>{sel.ward ?? "n/a"}</dd>
              <dt>position</dt><dd className="mono">{sel.lat.toFixed(5)}, {sel.lon.toFixed(5)}</dd>
              <dt>confidence</dt><dd className="mono">{pct(sel.confidence)} <small>category audit precision</small></dd>
              <dt>flags</dt><dd>{[sel.buffer_flag && "lake buffer", sel.near_drain && "near drain"].filter(Boolean).join(", ") || "none"}</dd>
              {sel.built_frac !== undefined && <><dt>built / road density</dt><dd className="mono">{sel.built_frac} / {sel.road_density} ({sel.n_orientations} orientations)</dd></>}
              {sel.lake && <><dt>lake</dt><dd>{sel.lake} ({sel.lake_acres} acres)</dd></>}
            </dl>
          </>}
          <h3 style={{ marginTop: 14 }}>Ranked leads <small>{list.length} shown, ha desc</small></h3>
          <div className="leads" role="listbox" aria-label="ranked leads">
            {list.map((s, i) => (
              <button key={s.rank} className={sel === s ? "on" : ""} onClick={() => setSel(s)} role="option" aria-selected={sel === s}>
                <span className="mono">{i + 1}</span><i style={{ background: CAT[cat(s.category)].color }} /><span>{CAT[cat(s.category)].label}</span>
                <span className="mono">{s.ha.toFixed(1)} ha</span><span className="trunc">{s.ward ?? "-"}</span><span className="mono">{s.buffer_flag ? "lake buffer" : ""}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Honesty panel <small>reviewer audit, not field-verified</small></h3>
          <dl className="dl">
            {lead && <><dt>Lead precision</dt><dd className="mono">{lead.precision.toFixed(2)} <small>({lead.real} real, {lead.wrong} wrong, {lead.unsure} unsure of {lead.n}); {lead.precision_excl_unsure.toFixed(2)} excluding unsure</small></dd></>}
            {chg && <><dt>Injected-patch recall</dt><dd className="mono">{Object.entries(chg.validation.injected.recall_by_size).map(([k, v]) => `${k} ha: ${pct(v as number)}`).join(", ")}</dd>
              <dt>OSM construction P / R</dt><dd className="mono">{chg.validation.osm.precision.toFixed(2)} / {chg.validation.osm.recall.toFixed(2)} <small>held-out half; OSM is sparse, precision understated</small></dd></>}
            {lead?.lake_leads && <><dt>Lake leads</dt><dd>{lead.lake_leads.n} flagged, {lead.lake_leads.confirmed_filling} confirmed filling: dry-season drying and desilting works. {lead.lake_leads.finding}</dd></>}
            {audit && <><dt>Per-category precision</dt><dd className="mono">{Object.entries(audit.per_category).map(([k, v]: any) => `${k} ${v.precision.toFixed(2)}`).join(" / ")}</dd></>}
          </dl>
          {chg && <p className="muted">{chg.validation.caveat}</p>}
          <p className="muted">{R.sites_blr.rainfall_caveat}</p>
        </section>

        <section className="panel">
          <h3>Wards <small>top by new built-up area</small></h3>
          <table className="tbl">
            <thead><tr><th>Ward</th><th>New built ha</th><th>Cleared ha</th><th>Growth</th><th>Conf.</th><th>Expected</th></tr></thead>
            <tbody>{ward.map((w: any) => (
              <tr key={w.ward_id}><td>{w.ward}</td><td className="mono">{w.new_built_ha.toFixed(1)}</td><td className="mono">{w.cleared_ha.toFixed(1)}</td>
                <td className="mono">{w.growth_pct.toFixed(1)}%</td><td className="mono">{pct(w.confidence)}</td>
                <td className="mono"><Rupee v={w.rupees_expected} name="rupees_per_ha.A" meta={rm} value={survey.rupees_per_ha_A} /></td></tr>))}</tbody>
          </table>
          <p className="muted">Expected = new built ha x {inr(survey.rupees_per_ha_A)}/ha x confidence. {survey.aoi_summary.growth_caveat}</p>
        </section>
      </div>
    </div>
  );
}
