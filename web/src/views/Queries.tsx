import { useEffect, useRef, useState } from "react";
import type { ViewProps } from "./props";
import type { Query } from "../types";
import { bytes, hm, ha as fha, msf } from "../fmt";
import { Rupee } from "../Assume";
import { useFlip, useTween } from "../anim";
import { Chip, ViewHead } from "../ui";

const LV = ["packet", "thumb", "full chip"];

export function QueriesView({ data, out, queries, setQueries, ms, bare }: ViewProps & { setQueries: (q: Query[]) => void; ms: number | null; bare?: boolean }) {
  const [d, setD] = useState<Query>({ id: "", pack: "A", aois: [data.tiles[0]?.aoi ?? "blr"], min_sev: 0.05, priority: 1 });
  const [leaving, setLeaving] = useState<string | null>(null);
  const aois = [...new Set(data.tiles.map((t) => t.aoi))];
  const qRef = useRef<HTMLOListElement>(null), dRef = useRef<HTMLOListElement>(null), seen = useRef(new Set(queries.map((q) => q.id)));
  const [flash, setFlash] = useState(0);
  useEffect(() => { if (ms !== null) setFlash((n) => n + 1); }, [ms]);
  const rm = (q: Query) => { setLeaving(q.id); setTimeout(() => { setQueries(queries.filter((x) => x !== q)); setLeaving(null); }, 220); };
  const top = out ? out.results.H2.sel.slice(0, 10) : [];
  useFlip(qRef, [queries]);
  useFlip(dRef, [out]);
  const hv = useTween(out?.results.H2.metrics.value ?? 0, 500), fv = useTween(out?.results.B1.metrics.value ?? 0, 500);
  const entering = (id: string) => { const n = !seen.current.has(id); return n; };
  useEffect(() => { queries.forEach((q) => seen.current.add(q.id)); }, [queries]);
  return (
    <div className="grid2">
      {!bare && <div className="span2"><ViewHead kicker="Track B" title="Downlink planner" sub={<span className="chip">Edit a priority: the plan reshuffles live</span>} /></div>}
      <section className="panel">
        <h3>Customer queries <small>{queries.length}, tile value sums over matching queries</small></h3>
        <ol className="qlist" ref={qRef}>
          {queries.map((q) => (
            <li key={q.id} data-key={q.id} className={`${leaving === q.id ? "leave" : ""} ${entering(q.id) ? "enter" : ""}`}>
              <span className="mono dim">{q.id}</span>
              <span>{q.name ?? `Pack ${q.pack}`} <small>{q.aois.join(", ")}, severity {"\u2265"} {q.min_sev}</small></span>
              <span className="btns">
                <label className="pri">priority <input type="range" min={0} max={5} step={0.1} value={q.priority} aria-label={`priority of ${q.id}`} onChange={(e) => setQueries(queries.map((x) => (x === q ? { ...x, priority: +e.target.value } : x)))} /><b className="mono">{q.priority.toFixed(1)}</b></label>
                <button onClick={() => rm(q)} aria-label={`remove ${q.id}`}>remove</button>
              </span>
            </li>
          ))}
        </ol>
        <form className="qform" onSubmit={(e) => { e.preventDefault(); setQueries([...queries, { ...d, id: `q${Date.now() % 100000}`, name: `Custom: Pack ${d.pack} ${d.aois[0]}` }]); }}>
          <label>pack <select value={d.pack} onChange={(e) => setD({ ...d, pack: e.target.value as "A" | "C" })}><option>A</option><option>C</option></select></label>
          <label>AOI <select value={d.aois[0]} onChange={(e) => setD({ ...d, aois: [e.target.value] })}>{aois.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label>min severity <input type="number" step={0.01} min={0} max={1} value={d.min_sev} onChange={(e) => setD({ ...d, min_sev: +e.target.value })} /></label>
          <label>priority <input type="number" step={0.1} min={0} value={d.priority} onChange={(e) => setD({ ...d, priority: +e.target.value })} /></label>
          <button type="submit" className="primary">Add query</button>
        </form>
      </section>
      <section className="panel">
        <h3>Schedule recompute <small>{data.tiles.length.toLocaleString()} tiles, 5 policies</small></h3>
        <div className="msrow">
          <div key={flash} className={`msbig mono flash ${ms !== null && ms < 60 ? "ok" : "bad"}`} aria-live="polite">{ms === null ? "..." : msf(ms)}</div>
          <div className="msnote"><Chip tone={ms !== null && ms < 60 ? "ok" : "bad"}>{ms !== null && ms < 60 ? "under 60 ms (gate G6)" : "over 60 ms (gate G6)"}</Chip>
            <span className="small dim">G6 measurement: performance.now() around post to Web Worker, schedule, return</span></div>
        </div>
        {out && <dl className="dl">
          <dt>HERALD value</dt><dd className="mono"><Rupee v={hv} name="rupees_per_ha" meta={data.meta.rupees_per_ha} value={data.params.rupees_per_ha} /></dd>
          <dt>FIFO value</dt><dd className="mono"><Rupee v={fv} name="rupees_per_ha" meta={data.meta.rupees_per_ha} value={data.params.rupees_per_ha} /></dd>
          <dt>Capacity (rho {out.rho})</dt><dd className="mono">{bytes(out.results.H2.metrics.capacity_bytes)}</dd>
        </dl>}
      </section>
      {!bare && <section className="panel span2">
        <h3>Downlink order <small>first 10 items HERALD sends, in contact order</small></h3>
        <ol className="dlist" ref={dRef}>
          {top.map(([ti, L, w], k) => { const t = data.tiles[ti], win = data.wins[w]; return (
            <li key={`${ti}:${L}`} data-key={`${ti}:${L}`}>
              <span className="mono dim">{k + 1}</span><span className="trunc">{t.aoi} <span className="dim">{t.kind}</span></span>
              <span className="mono r">{fha(t.ha, 1)}</span><Chip tone={L === 2 ? "acc" : undefined}>{LV[L]}</Chip>
              <span className="mono r dim">T+{hm(win.start_min)} {win.station}</span></li>); })}
        </ol>
      </section>}
    </div>
  );
}
