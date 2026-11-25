import { useEffect, useState } from "react";
import type { ViewProps } from "./props";
import { Kpi, Explainer, type Explain } from "../kit";
import { cardsFromText, verifyChainText } from "../canon";
import { ha as fha } from "../fmt";

const pc = (x: unknown, d = 0) => (typeof x === "number" ? `${(x * 100).toFixed(d)}%` : "n/a");
const n1 = (x: unknown, d = 1) => (typeof x === "number" ? x.toFixed(d) : "n/a");

const STEPS: { n: string; t: string; d: string; track: string; to: string }[] = [
  { n: "Capture", t: "Sentinel-2 replay", d: "10 m scenes, 46 x 46 tiles per AOI", track: "Input", to: "mission" },
  { n: "Onboard AI", t: "Classify and detect change", d: "int8 ResNet-18 plus index rules", track: "Track A and C", to: "model" },
  { n: "Value", t: "Rupees per tile", d: "ha x priority x rate, cloud-aware", track: "Track A and C", to: "econ" },
  { n: "Scheduler", t: "Pick what to send", d: "value per byte, per contact window", track: "Track B", to: "queries" },
  { n: "Downlink", t: "Packet, thumb, full", d: "FIFO vs HERALD race", track: "Track B", to: "fifo" },
  { n: "Insight", t: "Ledger, siting, evidence", d: "Leads and hash-chained cards", track: "Track A and C", to: "ledger" },
];

export function Overview({ data, go }: ViewProps & { go: (id: string) => void }) {
  const R = data.reports, sb = R.sites_blr, lead = R.audit_blr_lead, sim = R.sim, m = R.model, tc = R.audit_trackc;
  const r5 = sim?.by_rho?.[5];
  const [sit, setSit] = useState<any>(null);
  const [ev, setEv] = useState<{ ok: number; n: number } | null>(null);
  useEffect(() => { fetch("/data/siting.json").then((r) => r.json()).then(setSit, () => setSit(null)); }, []);
  useEffect(() => {
    (async () => {
      try { const r = await fetch("/data/evidence.json"); const t = await r.text(); const { cards } = cardsFromText(t); const v = await verifyChainText(t); setEv({ ok: v.ok ? cards.length : v.hashes, n: cards.length }); } catch { setEv(null); }
    })();
  }, []);
  const nc = sb ? sb.category_counts.new_layout.n + sb.category_counts.building_construction.n : null;
  const ncHa = sb ? sb.category_counts.new_layout.ha + sb.category_counts.building_construction.ha : null;
  const pv = sit?.validation?.pavagada_park?.as_is;
  const ex: Explain = {
    what: <>One screen for the whole project: three tracks that share one pipeline. Each card is a headline number read from the latest generated report; click it to open the view behind it.</>,
    why: <>The tracks answer one question from different ends: when a satellite can only send a few minutes of data per pass, which answers are worth the bytes, and can a reviewer trust them?</>,
    how: [
      <>Track A turns two Sentinel-2 dates into ranked construction leads in Bengaluru and a solar/wind siting map around Pavagada.</>,
      <>Track B simulates the downlink: a value-per-byte scheduler against FIFO on the same contact windows.</>,
      <>Track C produces hash-chained evidence cards for forest lost to mining.</>,
    ],
    caveats: [<>All of it is a replay of archived imagery; precision numbers are reviewer audits, not field checks; rupee figures are assumptions.</>],
  };
  return (
    <div className="ov">
      <header className="vh">
        <div className="kicker">Overview</div>
        <h2 className="headline">A satellite that sends home answers, not pictures</h2>
        <p className="sub">Real Sentinel-2 imagery of Bengaluru, Pavagada, Hasdeo Arand and the Sone river, replayed through an onboard classifier, a value scheduler and a tamper-evident evidence chain.</p>
        <Explainer e={ex} defaultOpen={false} />
      </header>

      <h3 className="grp">Pipeline <small>click a stage</small></h3>
      <ol className="pipe">
        {STEPS.map((s, i) => (
          <li key={s.n}><button onClick={() => go(s.to)}><span className="pn">{i + 1}</span><b>{s.n}</b><span>{s.t}</span><small>{s.d}</small><em>{s.track}</em></button></li>))}
      </ol>

      <div className="tracks">
        <section>
          <h3 className="grp">Track A <small>real-data change insights</small></h3>
          <div className="kgrid">
            <Kpi label="Construction leads" value={nc ?? "n/a"} onClick={() => go("ledger")} tone="acc"
              sub={<>{ncHa != null ? fha(ncHa, 0) : ""} new construction; audit precision {n1(lead?.precision_excl_unsure, 2)} excl. unsure ({n1(lead?.precision, 2)} incl.)</>}
              info={<>Count of merged new-layout and building sites of at least {sb?.min_site_ha} ha in north Bengaluru, 2023-02 to 2025-02. Precision: reviewer visual audit of {lead?.n} leads, {lead?.real} real, {lead?.wrong} wrong, {lead?.unsure} unsure. Source: sites_blr.json, audit_blr_lead.json.</>} />
            <Kpi label="Pavagada park percentile" value={pv ? `${n1(pv.mean_pct, 0)}` : "n/a"} onClick={() => go("siting")}
              sub={pv ? <>mean solar percentile of park cells; median {n1(pv.median_pct, 0)}, {pc(pv.share_top_decile)} in top decile</> : "siting.json not loaded"}
              info={<>Percentile of the real Pavagada solar park's cells among all ranked solar cells. A method that finds good land should place the existing park near 100. Source: siting.json validation.pavagada_park.as_is.</>} />
          </div>
        </section>
        <section>
          <h3 className="grp">Track B <small>onboard AI, orbit, scheduler</small></h3>
          <div className="kgrid">
            <Kpi label="HERALD vs FIFO, rho 5" value={<>{pc(r5?.pct_ub?.H2)} <span className="vs">vs {pc(r5?.pct_ub?.B1, 1)}</span></>} onClick={() => go("fifo")} tone="acc"
              sub={<>share of the upper bound delivered; {n1(r5?.ratio_vs_fifo?.H2, 0)}x FIFO</>}
              info={<>Value delivered divided by the fractional-knapsack upper bound, at oversubscription rho 5 (captured data is 5 times what the link carries). H2 is HERALD with a thumbnail first. Source: sim.json by_rho[5].pct_ub.</>} />
            <Kpi label="First insight" value={<>{n1(r5?.ttfi_min?.H2)} min</>} onClick={() => go("fifo")}
              sub={<>after capture; FIFO takes {n1(r5?.ttfi_min?.B1, 0)} min. HERALD matches FIFO's final value in {n1(r5?.minutes_to_match_fifo?.H2)} of {n1(r5?.fifo_minutes_used, 0)} contact min</>}
              info={<>Time from first capture until the first useful tile reaches the ground, in the simulated replay at rho 5. Source: sim.json by_rho[5].ttfi_min.</>} />
          </div>
        </section>
        <section>
          <h3 className="grp">Track C <small>protective evidence pack</small></h3>
          <div className="kgrid">
            <Kpi label="Mine-expansion precision" value={pc(tc?.precision?.hasdeo?.mine_expansion)} onClick={() => go("evidence")} tone="acc"
              sub={<>reviewer audit, Hasdeo Arand; {ev ? <>{ev.ok} of {ev.n} cards verify in this browser</> : "verifying chain"}</>}
              info={<>Share of audited mine-expansion leads judged real by a reviewer looking at 10 m crops ({tc?.counts?.hasdeo?.mine_expansion?.real} real, {tc?.counts?.hasdeo?.mine_expansion?.unsure} unsure, {tc?.counts?.hasdeo?.mine_expansion?.wrong} wrong). Cards verified: SHA-256 and chain links recomputed on page load. Source: audit_trackc.json, evidence.json.</>} />
          </div>
        </section>
        <section>
          <h3 className="grp">System <small>model, economics, gates</small></h3>
          <div className="kgrid">
            <Kpi label="Onboard model" value={pc(m?.eurosat?.top1_int8, 1)} onClick={() => go("model")}
              sub={<>EuroSAT top-1, int8; {n1(m?.latency?.ms_per_chip_int8_cpu_b64, 2)} ms per chip on a laptop CPU</>}
              info={<>Held-out EuroSAT test accuracy of the int8 model (n={m?.eurosat?.n_test}) and median int8 latency at batch 64. Host CPU, not flight hardware. Source: model.json.</>} />
          </div>
        </section>
      </div>
      <p className="muted small">Gates, caveats and the missed targets are listed under System, Gates and limits.</p>
    </div>
  );
}
