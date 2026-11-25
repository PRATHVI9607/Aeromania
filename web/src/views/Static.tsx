import type { Data } from "../data";
import { Rupee } from "../Assume";
import { Gates } from "./Gates";
import { bytes } from "../fmt";
import { useJson } from "../useJson";

const Card = ({ title, payer, children }: { title: string; payer: string; children: React.ReactNode }) => (
  <section className="panel"><h3>{title} <small>{payer}</small></h3><dl className="dl">{children}</dl></section>
);

export function Economics({ data }: { data: Data }) {
  const p = data.params, m = data.meta, R = data.reports;
  const sv = R.survey_blr, sit = R.siting, sim = R.sim;
  const wardRs = sv ? sv.wards_ranked.reduce((a: number, w: any) => a + w.rupees_expected, 0) : null;
  const rpm = p.rupees_per_contact_min;
  const sitMeta = (kind: "solar" | "wind", k: string) => ({ assumption: true, source: sit?.params?.[kind]?.[k]?.src ?? "config/siting.json" });
  const sw = useJson<any>("siting.json");
  const topS = sw?.top_solar?.[0];
  const cs = ["sone", "hasdeo"].map((a) => [a, R[`change_${a}_summary`]?.summary?.total_changed_ha] as const);
  return (
    <div>
      <div className="kicker">Who pays</div>
      <h2 className="headline">Four payers, every rupee an assumption</h2>
      <p className="muted">Hover or focus any amount for its parameter name and source note. Nothing here is a measured saving; products are shown with their inputs.</p>
      <div className="cards3">
        <Card title="City revenue and planning" payer="Pack A, property-tax survey triage">
          <dt>Rupees per ha of new built-up</dt><dd className="mono"><Rupee v={p.rupees_per_ha.A} name="rupees_per_ha.A" meta={m.rupees_per_ha} value={p.rupees_per_ha} /></dd>
          {sv && <><dt>New built-up detected</dt><dd className="mono">{sv.aoi_summary.new_built_ha} ha over {sv.aoi_summary.years.toFixed(1)} yr</dd>
            <dt>Expected recoverable value, all wards</dt><dd className="mono"><Rupee v={wardRs} name="survey_blr.wards_ranked[].rupees_expected" meta={{ assumption: true, source: `${sv.rupees_source} ${sv.rupees_note}` }} /></dd>
            <dt>Confidence</dt><dd><small>{sv.confidence_def}</small></dd></>}
        </Card>
        <Card title="Siting developer" payer="Pack A2, renewable siting around Pavagada">
          {topS ? <>
            <dt>Top solar cell</dt><dd className="mono">{topS.mw} MW, {topS.mwh_yr.toLocaleString("en-IN")} MWh/yr</dd>
            <dt>Revenue per year</dt><dd className="mono"><Rupee v={topS.revenue_rs_yr} name="solar.tariff_rs_kwh" meta={sitMeta("solar", "tariff_rs_kwh")} value={sit?.params?.solar?.tariff_rs_kwh?.v} /></dd>
            <dt>Net of grid connection</dt><dd className="mono"><Rupee v={topS.net_value_rs_yr} name="solar.grid_cr_per_km" meta={sitMeta("solar", "grid_cr_per_km")} value={sit?.params?.solar?.grid_cr_per_km?.v} /></dd>
          </> : <><dt>Status</dt><dd>reports/siting.json not generated yet</dd></>}
        </Card>
        <Card title="Mines and forest departments" payer="Pack C, evidence for enforcement">
          <dt>Rupees per ha (placeholder)</dt><dd className="mono"><Rupee v={p.rupees_per_ha.C} name="rupees_per_ha.C" meta={m.rupees_per_ha} value={p.rupees_per_ha} /></dd>
          {cs.map(([a, ha]) => ha != null && <><dt key={a}>{a}: changed area</dt><dd className="mono">{ha} ha, <Rupee v={ha * p.rupees_per_ha.C} name="rupees_per_ha.C x total_changed_ha" meta={m.rupees_per_ha} value={p.rupees_per_ha} /></dd></>)}
          <dt>Note</dt><dd><small>Rate is a placeholder in config/value.json; changed area is every detected change, not verified violations.</small></dd>
        </Card>
        <Card title="Satellite operator" payer="Platform, contact minutes saved">
          <dt>Rupees per contact minute</dt><dd className="mono"><Rupee v={rpm} name="rupees_per_contact_min" meta={m.rupees_per_contact_min} value={rpm} /></dd>
          {sim && [1, 2, 5, 10].map((r) => { const s = sim.by_rho[r]?.minutes_saved_vs_fifo?.H2; return s != null && <><dt key={r}>rho {r}: minutes saved vs FIFO</dt><dd className="mono">{s.toFixed(0)} min = <Rupee v={s * rpm} name="rupees_per_contact_min x minutes_saved" meta={m.rupees_per_contact_min} value={rpm} /></dd></>; })}
          <dt>Note</dt><dd><small>Minutes saved = FIFO minutes used minus minutes for HERALD to match FIFO's final value (sim.json). No vendor price is claimed.</small></dd>
        </Card>
      </div>
    </div>
  );
}

export function Hardware({ data }: { data: Data }) {
  const L = data.reports.model?.latency, e = data.reports.model?.eurosat;
  const b64 = L?.ms_per_chip_int8_cpu_b64;
  return (
    <div>
      <h2 className="headline">Onboard model, measured on a laptop CPU</h2>
      <p className="muted">Simulation only: no flight hardware, Raspberry Pi or ESP32 was used. These are host-CPU measurements of the int8 model; flight latency is not claimed.</p>
      {!L ? <section className="panel"><h3>Latency <small>not generated</small></h3><p className="muted">reports/model.json missing.</p></section> :
        <div className="grid2">
          <section className="panel"><h3>Latency <small>{L.cpu}</small></h3>
            <dl className="dl">
              <dt>int8, batch 64</dt><dd className="mono">{b64.toFixed(2)} ms/chip <span className={`st ${b64 < 1 ? "pass" : "fail"}`}>G4 {b64 < 1 ? "pass" : "not met"}</span></dd>
              <dt>int8, batch 64, best threads</dt><dd className="mono">{L.ms_per_chip_int8_cpu_b64_best?.toFixed(2)} ms/chip</dd>
              <dt>int8, batch 1</dt><dd className="mono">{L.ms_per_chip_int8_cpu_b1.toFixed(2)} ms/chip</dd>
              <dt>fp32, batch 64</dt><dd className="mono">{L.ms_per_chip_fp32_cpu_b64.toFixed(2)} ms/chip</dd>
              <dt>GPU (torch), batch 64</dt><dd className="mono">{L.ms_per_chip_torch_gpu_b64.toFixed(2)} ms/chip ({L.gpu})</dd>
              <dt>Method</dt><dd><small>{L.method}; 1-minute load average {L.load_avg_1m?.toFixed(1)} at measurement, so the machine was not idle.</small></dd>
            </dl>
            <p className="muted">Target is under 1 ms/chip on an idle machine. {b64 < 1 ? "The measured value meets it." : "The measured value misses it; a re-bench on an idle box is pending."}</p>
          </section>
          <section className="panel"><h3>Model</h3>
            <dl className="dl">
              <dt>Backbone</dt><dd>{data.reports.model.backbone}</dd>
              {e && <><dt>EuroSAT top-1</dt><dd className="mono">{(e.top1_fp32 * 100).toFixed(2)}% fp32, {(e.top1_int8 * 100).toFixed(2)}% int8 (n={e.n_test})</dd></>}
              {data.reports.model.onnx && <><dt>Artifacts</dt><dd className="mono"><small>{JSON.stringify(data.reports.model.onnx)}</small></dd></>}
              <dt>Packet / thumb sizes</dt><dd className="mono">{bytes(data.params.level_bytes[0])} / {bytes(data.params.level_bytes[1])}</dd>
            </dl>
          </section>
        </div>}
    </div>
  );
}

const LIMITS = [
  "Simulated replay of archived imagery as if captured; no satellite flew.",
  "Weak labels: WorldCover (~77% accurate) and incomplete OSM.",
  "One orbit; constellation size is modeled only through the oversubscription factor rho.",
  "Economic parameters are assumptions, not measurements.",
  "Sentinel-2 L2A (surface reflectance) is used where flight hardware would see TOA.",
  "The change engine is rule-based (indices and thresholds), not a learned model.",
  "The upper bound is a fractional-knapsack relaxation, not an optimum.",
  "Embedding-based change detection was tried and rejected (AUC 0.56 against the rules, 0.51-0.63 on injected patches); it stays in model.json as a negative result.",
  "10 m optical cannot see floors, height, vehicles or people; the new-layout vs building sub-type split is unreliable at this resolution.",
  "Lake-filling leads are unconfirmed: 10 flagged, 0 confirmed. Dry-season drying and desilting works explain the water loss between the two February dates.",
  "Lead precision comes from a reviewer visual audit of 10 m crops, not field verification.",
  "Capture timing is a compressed replay: day index is synthetic, time of day comes from real orbit geometry.",
];
export function About({ data, ms, runs }: { data: Data; ms: number | null; runs: number }) {
  return (
    <div className="grid2">
      <Gates data={data} ms={ms} runs={runs} />
      <section className="panel"><h3>Honest limitations</h3><ul className="limits">{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul></section>
      <section className="panel"><h3>Protective use</h3>
        <p className="muted">HERALD detects land-cover change only (bare sand, water-mask change, vegetation loss) at 10 m. It cannot see people or vehicles and is not used to track individuals. No weapons, targeting or surveillance of persons.</p>
        <p className="muted">Outputs are evidence leads for authorized departments and require ground verification. Evidence cards are hash-chained for tamper evidence, not legal admissibility.</p>
        <p className="muted">Globe: CesiumJS with bundled Natural Earth II imagery. No Cesium ion, no network tiles.</p>
      </section>
    </div>
  );
}
