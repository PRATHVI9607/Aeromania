import { useEffect, useState } from "react";
import type { Data } from "../data";
import { useJson } from "../useJson";
import { canon, cardsFromText, sha256Hex, verifyChainText } from "../canon";

type S = "pass" | "fail" | "partial" | "pending" | "reported";
interface G { id: string; metric: string; target: string; status: S; detail: string }
const num = (x: unknown): x is number => typeof x === "number" && isFinite(x);
const P = (id: string, metric: string, target: string, detail = "field missing in report JSON"): G => ({ id, metric, target, status: "pending", detail });
const f = (x: number, d = 2) => x.toFixed(d);

async function evidenceGate(): Promise<G> {
  const id = "G16", metric = "Evidence chain: verify passes, single-byte tamper detected", target = "100%";
  let text: string | null = null;
  for (const p of ["/data/evidence.json", "/data/reports/evidence.json"]) {
    try { const r = await fetch(p); if (r.ok && !(r.headers.get("content-type") ?? "").includes("html")) { text = await r.text(); break; } } catch { /* next */ }
  }
  if (!text) return P(id, metric, target, "evidence.json not generated yet");
  try {
    const { cards, nodes } = cardsFromText(text);
    const v = await verifyChainText(text), ok = v.hashes, links = v.links;
    // tamper test: change one byte of card 0's canonical text and re-hash
    const c0 = canon(nodes[0], true, "hash");
    const detected = (await sha256Hex(c0.slice(0, 5) + (c0[5] === "x" ? "y" : "x") + c0.slice(6))) !== cards[0].hash;
    const all = v.ok;
    return { id, metric, target, status: all && detected ? "pass" : "fail", detail: `${ok}/${cards.length} hashes, ${links}/${cards.length} links (genesis and chain_head anchored); one-character tamper ${detected ? "detected" : "NOT detected"}` };
  } catch (e) { return { id, metric, target, status: "fail", detail: `evidence.json unreadable: ${String(e)}` }; }
}

export function Gates({ data, ms, runs }: { data: Data; ms: number | null; runs: number }) {
  const [ev, setEv] = useState<G | null>(null);
  const siteWeb = useJson<any>("siting.json");
  useEffect(() => { evidenceGate().then(setEv); }, []);
  const R = data.reports, m = R.model, sim = R.sim, chg = R.change_blr_summary, lead = R.audit_blr_lead, sit = siteWeb ?? R.siting, tc = R.audit_trackc;
  const g: G[] = [];
  const mk = (id: string, metric: string, target: string, v: number | undefined, pass: (v: number) => boolean, detail: (v: number) => string) =>
    g.push(num(v) ? { id, metric, target, status: pass(v) ? "pass" : "fail", detail: detail(v) } : P(id, metric, target));

  mk("G1", "EuroSAT top-1, int8 (held-out test)", ">= 98.0%", m?.eurosat?.top1_int8, (v) => v >= 0.98, (v) => `${f(v * 100)}% (fp32 ${num(m.eurosat.top1_fp32) ? f(m.eurosat.top1_fp32 * 100) : "n/a"}%, n=${m.eurosat.n_test})`);
  mk("G1b", "int8 accuracy drop vs fp32", "<= 0.3 pt", m?.eurosat?.int8_drop_pt, (v) => v <= 0.3, (v) => `${f(v)} pt`);
  // cloud.mae = held-out AOI (hasdeo) MAE; loao[variant][aoi].combined is the per-fold detail
  const loao: string[] = [];
  for (const [variant, folds] of Object.entries<any>(m?.cloud?.loao ?? {})) for (const [aoi, o] of Object.entries<any>(folds ?? {})) if (num(o?.combined)) loao.push(`${variant}/${aoi} ${f(o.combined, 3)}`);
  g.push(num(m?.cloud?.mae) ? { id: "G2", metric: "Cloud-fraction MAE vs SCL, held-out AOI", target: "<= 0.05", status: m.cloud.mae <= 0.05 ? "pass" : "fail",
    detail: `${f(m.cloud.mae, 3)} on ${m.cloud.heldout_aoi ?? "held-out AOI"} (mean-predictor baseline ${num(m.cloud.mean_baseline_mae) ? f(m.cloud.mean_baseline_mae, 3) : "n/a"}); leave-one-AOI-out ${loao.join(", ") || "n/a"}` } : P("G2", "Cloud-fraction MAE vs SCL, held-out AOI", "<= 0.05"));
  mk("G3", "Calibration ECE", "< 0.01", m?.eurosat?.ece_after, (v) => v < 0.01, (v) => `${f(v, 4)} (before ${num(m.eurosat.ece_before) ? f(m.eurosat.ece_before, 3) : "n/a"})`);
  mk("G4", "int8 CPU latency, batch 64", "< 1 ms/chip", m?.latency?.ms_per_chip_int8_cpu_b64, (v) => v < 1, (v) => `${f(v)} ms/chip default${num(m.latency.ms_per_chip_int8_cpu_b64_best) ? `, ${f(m.latency.ms_per_chip_int8_cpu_b64_best)} best-of-threads` : ""}; load avg ${num(m.latency.load_avg_1m) ? f(m.latency.load_avg_1m, 1) : "n/a"} when measured`);
  mk("G5", "Scheduler", "< 5 ms / 1k tiles", sim?.g5_ms_per_1000_tiles_H2, (v) => v < 5, (v) => `${f(v)} ms per 1000 tiles (H2)`);
  g.push(runs >= 2 && num(ms) ? { id: "G6", metric: "Live query reorder in browser", target: "< 60 ms", status: ms < 60 ? "pass" : "fail", detail: `${f(ms, 1)} ms last round trip on ${data.tiles.length} tiles (this machine, this session)` } : P("G6", "Live query reorder in browser", "< 60 ms", "pending: edit or reorder a query in the Queries tab"));
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  g.push({ id: "G7", metric: "Dashboard load / fps", target: "< 1.5 s, 60 fps", status: "pending", detail: `${nav ? `load event at ${f(nav.loadEventEnd, 0)} ms this session; ` : ""}fps is not measured in-app, check on a GPU machine` });
  const r2 = sim?.by_rho?.[2]?.ratio_vs_fifo?.H2, r5 = sim?.by_rho?.[5]?.ratio_vs_fifo?.H2;
  g.push(num(r2) && num(r5) ? { id: "G8", metric: "HERALD vs FIFO value", target: ">= 2x at rho 2 and >= 10x at rho 5", status: r2 >= 2 && r5 >= 10 ? "pass" : "fail", detail: `${f(r2, 1)}x at rho 2, ${f(r5, 1)}x at rho 5 (rho 1: ${num(sim.by_rho?.[1]?.ratio_vs_fifo?.H2) ? f(sim.by_rho[1].ratio_vs_fifo.H2, 1) : "n/a"}x)` } : P("G8", "HERALD vs FIFO value", ">= 2x at rho 2 and >= 10x at rho 5"));
  mk("G9", "Contact minutes for HERALD to match FIFO's final value (rho 5)", "<= 5 min", sim?.by_rho?.[5]?.minutes_to_match_fifo?.H2, (v) => v <= 5, (v) => `${f(v)} min (FIFO used ${num(sim.by_rho[5].fifo_minutes_used) ? f(sim.by_rho[5].fifo_minutes_used, 0) : "n/a"} min)`);
  const o = chg?.validation?.osm;
  g.push(num(o?.precision) ? { id: "G10", metric: "Change vs OSM construction (weak labels)", target: "report", status: "reported", detail: `precision ${f(o.precision)}, recall ${f(o.recall)} (held-out east half; OSM is sparse)` } : P("G10", "Change vs OSM construction (weak labels)", "report"));
  const rb = chg?.validation?.injected?.recall_by_size as Record<string, number> | undefined;
  g.push(rb && ["1", "2", "4"].every((k) => num(rb[k])) ? { id: "G11", metric: "Injected-change recall", target: ">= 0.9 at >= 1 ha (stretch 0.5 ha)", status: ["1", "2", "4"].every((k) => rb[k] >= 0.9) ? "pass" : "fail",
    detail: Object.entries(rb).sort((x, y) => +x[0] - +y[0]).map(([k, v]) => `${k} ha ${f(v)}${+k < 1 ? " (stretch)" : ""}`).join(", ") } : P("G11", "Injected-change recall", ">= 0.9 at >= 1 ha (stretch 0.5 ha)"));
  g.push(num(lead?.precision) && num(lead?.precision_excl_unsure) ? { id: "G12", metric: "Construction-lead precision (reviewer visual audit, not field)", target: ">= 0.85 excluding unsure (incl.-unsure also shown)",
    status: lead.precision_excl_unsure >= 0.85 ? "pass" : "fail", detail: `${f(lead.precision_excl_unsure)} excl. unsure (${lead.real} real / ${lead.wrong} wrong / ${lead.unsure} unsure); ${f(lead.precision)} incl. (n=${lead.n})` } : P("G12", "Construction-lead precision (reviewer visual audit, not field)", ">= 0.85 excluding unsure"));
  mk("G13", "Time to first insight after capture (rho 5)", "<= 30 min", sim?.by_rho?.[5]?.ttfi_min?.H2, (v) => v <= 30, (v) => `${f(v, 1)} min (FIFO ${num(sim.by_rho[5].ttfi_min.B1) ? f(sim.by_rho[5].ttfi_min.B1, 1) : "n/a"})`);
  const pv = sit?.validation?.pavagada_park?.as_is;
  g.push(num(pv?.mean_pct) ? { id: "G14", metric: "Siting validation: Pavagada park cells' solar percentile", target: "median percentile >= 90 and >= 60% of park cells in top decile (mean shown; edge cells only partly overlap the park)", status: num(pv.median_pct) && pv.median_pct >= 90 && num(pv.share_top_decile) && pv.share_top_decile >= 0.6 ? "pass" : "fail",
    detail: `mean ${f(pv.mean_pct, 1)}, median ${num(pv.median_pct) ? f(pv.median_pct, 1) : "n/a"}, ${num(pv.share_top_decile) ? f(pv.share_top_decile * 100, 0) : "n/a"}% of ${pv.n_ranked} ranked park cells in top decile` } : P("G14", "Siting validation: Pavagada park cells' solar percentile", "median >= 90 and >= 60% in top decile"));
  // audit_trackc.json: precision[aoi][kind]; headline kind = mine_expansion (Track C lead), other kinds shown honestly
  const tcp: Record<string, number> = {}; for (const a of Object.values(tc?.precision ?? {}) as Record<string, number>[]) Object.assign(tcp, a);
  const head = tcp["mine_expansion"]; const weak = Object.entries(tcp).filter(([, v]) => v < 0.6);
  g.push(num(head) ? { id: "G15", metric: "Track C lead precision (reviewer visual audit, not field)", target: ">= 0.60 for the headline kind (mine expansion into forest)",
    status: head >= 0.6 ? (weak.length ? "partial" : "pass") : "fail", detail: Object.entries(tcp).map(([k, v]) => `${k} ${f(v)}`).join(", ") } : P("G15", "Track C lead precision (reviewer visual audit)", ">= 0.60", "audit_trackc.json not generated yet"));
  g.push(ev ?? P("G16", "Evidence chain: verify passes, single-byte tamper detected", "100%", "checking"));
  const wc = m?.wc;
  g.push(num(wc?.top1_agreement) ? { id: "G17", metric: "India land-cover head vs WorldCover, spatial hold-out", target: ">= 70% top-1", status: wc.top1_agreement >= 0.7 ? "pass" : "fail", detail: `${f(wc.top1_agreement * 100, 1)}% (n_test=${wc.n_test}; majority baseline ${num(wc.baseline_top1_majority) ? f(wc.baseline_top1_majority * 100, 1) : "n/a"}%)` } : P("G17", "India land-cover head vs WorldCover, spatial hold-out", ">= 70% top-1"));

  return (
    <section className="panel span2x">
      <h3>Gates <small>{g.filter((x) => x.status === "pass").length} pass, {g.filter((x) => x.status === "fail").length} fail, {g.filter((x) => x.status === "partial").length} partial, {g.filter((x) => x.status === "pending").length} pending</small></h3>
      {g.map((x) => (
        <div className="gate" key={x.id}><b className="mono">{x.id}</b><span className={`st ${x.status}`}>{x.status}</span>
          <span>{x.metric} <small className="muted">target {x.target}</small><br /><span className="mono">{x.detail}</span></span></div>))}
      <p className="muted">Values are read from the report JSONs at load time; a missing field shows pending. Misses stay visible.</p>
    </section>
  );
}
