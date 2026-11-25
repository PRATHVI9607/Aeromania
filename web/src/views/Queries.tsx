import { useState } from "react";
import type { ViewProps } from "./props";
import type { Query } from "../types";
import { bytes } from "../fmt";
import { Rupee } from "../Assume";

export function QueriesView({ data, out, queries, setQueries, ms }: ViewProps & { setQueries: (q: Query[]) => void; ms: number | null }) {
  const [d, setD] = useState<Query>({ id: "", pack: "A", aois: [data.tiles[0]?.aoi ?? "blr"], min_sev: 0.05, priority: 1 });
  const aois = [...new Set(data.tiles.map((t) => t.aoi))];
  const mv = (i: number, k: number) => { const a = queries.slice(); [a[i], a[i + k]] = [a[i + k], a[i]]; setQueries(a); };
  return (
    <div className="grid2">
      <section className="panel">
        <h3>Customer queries <small>{queries.length}</small></h3>
        <ol className="qlist">
          {queries.map((q, i) => (
            <li key={q.id}>
              <span className="mono">{q.id}</span>
              <span>{q.name ?? `Pack ${q.pack}`} <small>{q.aois.join(",")}, sev &ge; {q.min_sev}, x{q.priority}</small></span>
              <span className="btns">
                <button disabled={i === 0} onClick={() => mv(i, -1)} aria-label={`move ${q.id} up`}>up</button>
                <button disabled={i === queries.length - 1} onClick={() => mv(i, 1)} aria-label={`move ${q.id} down`}>down</button>
                <button onClick={() => setQueries(queries.filter((x) => x !== q))} aria-label={`remove ${q.id}`}>remove</button>
              </span>
            </li>
          ))}
        </ol>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); setQueries([...queries, { ...d, id: `q${Date.now() % 100000}`, name: `Custom: Pack ${d.pack} ${d.aois[0]}` }]); }}>
          <label>pack <select value={d.pack} onChange={(e) => setD({ ...d, pack: e.target.value as "A" | "C" })}><option>A</option><option>C</option></select></label>
          <label>AOI <select value={d.aois[0]} onChange={(e) => setD({ ...d, aois: [e.target.value] })}>{aois.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label>min severity <input type="number" step={0.01} min={0} max={1} value={d.min_sev} onChange={(e) => setD({ ...d, min_sev: +e.target.value })} /></label>
          <label>priority <input type="number" step={0.1} min={0} value={d.priority} onChange={(e) => setD({ ...d, priority: +e.target.value })} /></label>
          <button type="submit" className="primary">add query</button>
        </form>
      </section>
      <section className="panel">
        <h3>Schedule recompute</h3>
        <div className={`big mono ${ms !== null && ms < 100 ? "ok" : "bad"}`} aria-live="polite">{ms === null ? "..." : `${ms.toFixed(1)} ms`}</div>
        <p className="muted">Measured round trip with performance.now(): post to Web Worker, schedule {data.tiles.length.toLocaleString()} tiles under 5 policies, return. Target &lt; 100 ms.</p>
        {out && <dl className="dl">
          <dt>HERALD value</dt><dd className="mono"><Rupee v={out.results.H2.metrics.value} name="rupees_per_ha" meta={data.meta.rupees_per_ha} value={data.params.rupees_per_ha} /></dd>
          <dt>FIFO value</dt><dd className="mono"><Rupee v={out.results.B1.metrics.value} name="rupees_per_ha" meta={data.meta.rupees_per_ha} value={data.params.rupees_per_ha} /></dd>
          <dt>Upper bound</dt><dd className="mono"><Rupee v={out.results.H2.metrics.ub} name="rupees_per_ha" meta={data.meta.rupees_per_ha} value={data.params.rupees_per_ha} /></dd>
          <dt>Capacity (rho {out.rho})</dt><dd className="mono">{bytes(out.results.H2.metrics.capacity_bytes)}</dd>
        </dl>}
      </section>
    </div>
  );
}
