import type { Data } from "../data";
import { Rupee } from "../Assume";

const Placeholder = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <section className="panel"><h3>{title} <small>placeholder</small></h3>{children}</section>
);
const has = (d: Data, k: string) => Object.keys(d.reports).filter((r) => r.startsWith(k));

export function Evidence({ data }: { data: Data }) {
  return <Placeholder title="Evidence (Pack C)"><p className="muted">Evidence cards with SHA-256 chain and verify button arrive with reports/evidence.json. Found: {has(data, "evidence").join(", ") || "none"}.</p></Placeholder>;
}
export function Economics({ data }: { data: Data }) {
  const p = data.params, m = data.meta;
  return (
    <Placeholder title="Economics">
      <p className="muted">All rupee figures are assumptions. Hover or focus a number for its parameter name and source note.</p>
      <dl className="dl">
        <dt>Pack A rupees per hectare</dt><dd className="mono"><Rupee v={p.rupees_per_ha.A} name="rupees_per_ha" meta={m.rupees_per_ha} value={p.rupees_per_ha} /></dd>
        <dt>Pack C rupees per hectare</dt><dd className="mono"><Rupee v={p.rupees_per_ha.C} name="rupees_per_ha" meta={m.rupees_per_ha} value={p.rupees_per_ha} /></dd>
        <dt>Rupees per contact minute</dt><dd className="mono"><Rupee v={p.rupees_per_contact_min} name="rupees_per_contact_min" meta={m.rupees_per_contact_min} /></dd>
        <dt>Freshness half-life</dt><dd className="mono">{p.half_life_h} h</dd>
        <dt>Level value fractions</dt><dd className="mono">{p.level_fraction.join(" / ")} <small>packet / thumb / full</small></dd>
      </dl>
    </Placeholder>
  );
}
export function Hardware({ data }: { data: Data }) {
  const m = data.reports.model?.latency;
  return <Placeholder title="Hardware"><p className="muted">Pi/ESP32 benchmark view is not built yet. Host int8 latency from reports/model.json: {m ? `${m.ms_per_chip_int8_cpu_b64} ms/chip (${m.device})` : "not available"}.</p></Placeholder>;
}

const LIMITS = [
  "Simulated replay of archived imagery as if captured; no satellite flew.",
  "Weak labels: WorldCover (~77% accurate) and incomplete OSM.",
  "One orbit; constellation size is modeled only through the oversubscription factor rho.",
  "Economic parameters are assumptions, not measurements.",
  "Sentinel-2 L2A (surface reflectance) is used where flight hardware would see TOA.",
  "The change engine is rule-based.",
  "The upper bound is a fractional-knapsack relaxation, not an optimum.",
];
export function About() {
  return (
    <div className="grid2">
      <section className="panel"><h3>Honest limitations</h3><ul className="limits">{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul></section>
      <section className="panel"><h3>Protective use</h3>
        <p className="muted">HERALD detects land-cover change only (bare sand, water-mask change, vegetation loss) at 10 m. It cannot see people or vehicles and is not used to track individuals. No weapons, targeting or surveillance of persons.</p>
        <p className="muted">Outputs are evidence leads for authorized departments and require ground verification. Evidence cards are hash-chained for tamper evidence, not legal admissibility.</p>
        <p className="muted">Globe: CesiumJS with bundled Natural Earth II imagery. No Cesium ion, no network tiles.</p>
      </section>
    </div>
  );
}
