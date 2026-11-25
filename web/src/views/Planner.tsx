import { lazy, Suspense, useMemo, useRef, useState } from "react";
import type { ViewProps } from "./props";
import type { Query } from "../types";
import { capacities, prepare } from "../sched";
import { bytes, hm, ha as fha, inr } from "../fmt";
import { Kpi, Empty, Tabs, Info, Explainer } from "../kit";
import { Guard, Skeleton, ViewHead } from "../ui";
import { download, toCSV } from "../work";
import { QueriesView } from "./Queries";
import { TileWalk } from "./TileWalk";

const Deep = lazy(() => import.meta.glob("../deep/TrackB.tsx")["../deep/TrackB.tsx"]?.() as Promise<any> ?? Promise.resolve({ default: () => <Empty title="Deep dive not installed">web/src/deep/TrackB.tsx is not present in this build.</Empty> }));
const LV = ["packet", "thumb", "full chip"];

export function Planner(p: ViewProps & { setQueries: (q: Query[]) => void; ms: number | null }) {
  const { data, out, queries, rho } = p;
  const prep = useMemo(() => prepare(data.tiles, queries, data.params), [data.tiles, queries, data.params]);
  const caps = useMemo(() => capacities(data.wins, data.params, rho, prep.B)[0], [data.wins, data.params, rho, prep.B]);
  const fr = data.params.level_fraction;
  const plan = useMemo(() => {
    const by = new Map<number, { ti: number; L: number; value: number; bytes: number }[]>();
    for (const [ti, L, w] of out?.results.H2.sel ?? []) {
      const lo = L ? fr[L - 1] : 0, bl = L ? prep.B[ti][L - 1] : 0;
      (by.get(w) ?? by.set(w, []).get(w)!).push({ ti, L, value: prep.V[ti] * (fr[L] - lo), bytes: prep.B[ti][L] - bl });
    }
    return by;
  }, [out, prep, fr]);
  const passes = useMemo(() => [...plan.keys()].sort((a, b) => data.wins[a].start_min - data.wins[b].start_min), [plan, data.wins]);
  const [selW, setSelW] = useState<number | null>(null);
  const w = selW != null && plan.has(selW) ? selW : passes[0];
  const items = w != null ? plan.get(w)! : [];
  const used = items.reduce((a, x) => a + x.bytes, 0), val = items.reduce((a, x) => a + x.value, 0);
  // what moved since the previous plan: items now in a different pass (or new to the plan)
  const prevMap = useRef(new Map<string, number>()), curMap = useRef(new Map<string, number>()), lastOut = useRef(out);
  if (out !== lastOut.current) { lastOut.current = out; prevMap.current = curMap.current; curMap.current = new Map(); }
  if (curMap.current.size === 0 && plan.size) for (const [wi, xs] of plan) for (const x of xs) curMap.current.set(`${x.ti}:${x.L}`, wi);
  const moved = (x: { ti: number; L: number }) => prevMap.current.size > 0 && prevMap.current.get(`${x.ti}:${x.L}`) !== w;
  const nMoved = items.filter(moved).length;
  const csv = () => download(`herald_pass_${w != null ? data.wins[w].id : "none"}_plan.csv`, "text/csv", toCSV(items.map((x, k) => { const t = data.tiles[x.ti]; return { order: k + 1, station: data.wins[w!].station, pass_start: hm(data.wins[w!].start_min), tile: t.id, aoi: t.aoi, kind: t.kind, lat: t.lat, lon: t.lon, level: LV[x.L], bytes: x.bytes, value_rs: Math.round(x.value), cloud: t.cloud, ha: t.ha }; }), ["order", "station", "pass_start", "tile", "aoi", "kind", "lat", "lon", "level", "bytes", "value_rs", "cloud", "ha"]));
  const m = out?.results.H2.metrics, f = out?.results.B1.metrics;
  const tool = (
    <div>
      <div className="kgrid k4">
        <Kpi label="Passes with a plan" value={passes.length} sub={`${data.wins.length} contact windows, rho ${rho}`} info={<>Contact windows (satellite above a ground station) in which the scheduler assigns at least one item. Rho is how many times more data was captured than the link carries; set it on the Downlink: FIFO vs HERALD view.</>} />
        <Kpi label="Plan value" value={m ? inr(m.value) : "n/a"} tone="acc" sub={f ? `FIFO would deliver ${inr(f.value)} on the same passes` : ""} info={<>Sum of tile value delivered by HERALD (H2) over all passes, for the current queries. Rupee values are assumptions (config/value.json).</>} />
        <Kpi label="Selected pass" value={w != null ? `T+${hm(data.wins[w].start_min)}` : "n/a"} sub={w != null ? `${data.wins[w].station}, ${(data.wins[w].end_min - data.wins[w].start_min).toFixed(1)} min` : ""} />
        <Kpi label="Bytes used / capacity" value={w != null ? `${bytes(used)}` : "n/a"} sub={w != null ? `of ${bytes(caps[w])} (${caps[w] > 0 ? ((used / caps[w]) * 100).toFixed(0) : "0"}%)` : ""} info={<>Capacity of a window = total full-size bytes / rho, split by window duration. Items are packed until the next one does not fit.</>} />
      </div>
      {passes.length === 0 ? <Empty title="No plan yet">The scheduler is computing, or no query matches any tile. Add a query below.</Empty> : (
        <div className="split">
          <section className="panel"><h3>Next passes <small>time after first capture</small></h3>
            <div className="passes" role="listbox" aria-label="passes">{passes.slice(0, 80).map((wi) => { const xs = plan.get(wi)!, v = xs.reduce((a, x) => a + x.value, 0); return (
              <button key={wi} role="option" aria-selected={wi === w} className={wi === w ? "on" : ""} onClick={() => setSelW(wi)}><span>T+{hm(data.wins[wi].start_min)}</span><span className="trunc dim">{data.wins[wi].station}, {xs.length} items</span><span className="r">{inr(v)}</span></button>); })}</div>
          </section>
          <section className="panel">
            <h3>What goes down in this pass <small>{items.length} items, {inr(val)}{nMoved > 0 && <span className="pill">{nMoved} moved by your last edit</span>}</small><span className="btns"><button onClick={csv}>Export pass plan CSV</button></span></h3>
            <div className="capbar" role="img" aria-label={`${((used / caps[w!]) * 100).toFixed(0)} percent of capacity used`}><b style={{ width: `${Math.min(100, (used / caps[w!]) * 100)}%` }} /></div>
            <div className="tblwrap" style={{ maxHeight: 360 }}><table className="tbl"><thead><tr><th>#</th><th>Tile</th><th>AOI, kind</th><th>Level</th><th className="r">Bytes</th><th className="r">Value</th><th className="r">Cloud</th></tr></thead>
              <tbody>{items.slice(0, 200).map((x, k) => { const t = data.tiles[x.ti]; return (
                <tr key={`${x.ti}:${x.L}`} className={moved(x) ? "mv" : ""}><td className="mono">{k + 1}</td><td className="mono">{t.id}</td><td>{t.aoi} <span className="dim">{t.kind}, {fha(t.ha, 1)}</span></td><td>{LV[x.L]}</td><td className="mono r">{bytes(x.bytes)}</td><td className="mono r">{inr(x.value)}</td><td className="mono r">{(t.cloud * 100).toFixed(0)}%</td></tr>); })}</tbody></table></div>
          </section>
        </div>)}
      <h3 className="grp">Customer queries <Info title="Customer queries">A query is one customer's interest: which AOI, the minimum severity of change, and a priority multiplier. A tile's value sums over every query it matches.</Info></h3>
      <QueriesView {...p} bare />
    </div>
  );
  return (
    <div>
      <ViewHead kicker="Track B" title="Downlink plan per pass"
        sub={<span className="chip">{p.ms != null ? `${p.ms.toFixed(1)} ms last run` : "computing"}</span>} />
      <Tabs tabs={[
        { id: "plan", label: "Plan", node: () => tool },
        { id: "how", label: "How it works", node: () => <TileWalk {...p} /> },
        { id: "deep", label: "Deep dive", node: () => <Guard label="Track B deep dive"><Suspense fallback={<Skeleton rows={4} />}><Deep {...p} /></Suspense></Guard> },
      ]} />
    </div>
  );
}
