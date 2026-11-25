import { useEffect, useMemo, useRef } from "react";
import type { ViewProps } from "./props";
import type { PolicyId, RunOut } from "../types";
import { bytes, inr } from "../fmt";
import { Rupee } from "../Assume";

const POL: { id: PolicyId; name: string; color: string }[] = [
  { id: "B1", name: "FIFO", color: "#7b8794" }, { id: "B2", name: "Cloud filter + FIFO", color: "#9aa5b1" },
  { id: "B3", name: "Value greedy", color: "#52606d" }, { id: "H1", name: "Value/byte", color: "#c9852a" },
  { id: "H2", name: "HERALD progressive", color: "#f2a93b" },
];
const RH = 11;

function Timeline({ r, data, title }: { r: RunOut; data: ViewProps["data"]; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nw = data.wins.length;
  const byWin = useMemo(() => {
    const m: [number, number][][] = Array.from({ length: nw }, () => []);
    for (const [i, L, w] of r.sel) m[w].push([i, L]);
    return m;
  }, [r, nw]);
  useEffect(() => {
    const c = ref.current!, dpr = devicePixelRatio || 1, W = c.clientWidth;
    c.width = W * dpr; c.height = nw * RH * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr);
    const cap = r.timeline.cap, maxCap = Math.max(...cap, 1);
    for (let y = 0; y < nw; y++) {
      g.fillStyle = "#171d25"; g.fillRect(0, y * RH, (cap[y] / maxCap) * W, RH - 2);
      let x = 0;
      for (const [i, L] of byWin[y]) {
        const t = data.tiles[i];
        const b = L === 0 ? data.params.level_bytes[0] : L === 1 ? data.params.level_bytes[1] - data.params.level_bytes[0] : Math.max(t.full_bytes, data.params.level_bytes[1] + 1) - data.params.level_bytes[1];
        const wd = (b / maxCap) * W;
        g.fillStyle = t.cloud > 0.5 ? "#5b6670" : `hsl(36 ${35 + 20 * L}% ${30 + 30 * Math.min(1, t.sev * 2)}%)`;
        g.fillRect(x, y * RH, Math.max(wd - 0.4, 0.6), RH - 2);
        x += wd;
      }
    }
  }, [r, byWin, data, nw]);
  return (
    <div className="panel">
      <h3>{title} <small>{bytes(r.metrics.bytes_sent)} sent, {bytes(r.metrics.cloud_bytes)} on cloudy tiles</small></h3>
      <canvas ref={ref} style={{ width: "100%", height: nw * RH }} aria-label={`${title} per-window byte timeline`} />
    </div>
  );
}

function Curves({ out, data }: { out: NonNullable<ViewProps["out"]>; data: ViewProps["data"] }) {
  const W = 1300, H = 300, m = { l: 90, r: 12, t: 14, b: 24 };
  const ub = out.results.B1.metrics.ub, wins = data.wins;
  const t0 = wins[0].start_min, t1 = wins[wins.length - 1].end_min;
  const ymax = Math.max(ub, 1) * 1.05;
  const x = (t: number) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const days = Math.floor((t1 - t0) / 1440);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Cumulative realized value by policy">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}><line x1={m.l} x2={W - m.r} y1={y(f * ymax)} y2={y(f * ymax)} className="grid" />
          <text x={m.l - 6} y={y(f * ymax) + 3} textAnchor="end" className="ax">{inr(f * ymax)}</text></g>
      ))}
      {Array.from({ length: days + 1 }, (_, d) => <text key={d} x={x(t0 + d * 1440)} y={H - 6} textAnchor="middle" className="ax">day {d}</text>)}
      <line x1={m.l} x2={W - m.r} y1={y(ub)} y2={y(ub)} className="ub" />
      <text x={W - m.r} y={y(ub) - 4} textAnchor="end" className="ax">upper bound (relaxation)</text>
      {POL.map((p) => {
        const cv = out.results[p.id].timeline.cum_value;
        const d = `M${x(t0)},${y(0)}` + cv.map((v, i) => `L${x(wins[i].end_min).toFixed(1)},${y(v).toFixed(1)}`).join("");
        return <path key={p.id} d={d} fill="none" stroke={p.color} strokeWidth={p.id === "H2" ? 2.4 : 1.3} />;
      })}
    </svg>
  );
}

export function Fifo({ data, out, rho, setRho }: ViewProps & { setRho: (n: number) => void }) {
  if (!out || !data.wins.length) return <div className="boot">scheduling</div>;
  const f = out.results.B1.metrics, h = out.results.H2.metrics;
  const saved = f.minutes_to_90 !== null && h.minutes_to_90 !== null ? f.minutes_to_90 - h.minutes_to_90 : null;
  const rpm = data.params.rupees_per_contact_min;
  return (
    <div className="grid2">
      <section className="span2 bar">
        <label>Oversubscription rho
          <input type="range" min={0} max={3} step={1} value={[1, 2, 5, 10].indexOf(rho)} onChange={(e) => setRho([1, 2, 5, 10][+e.target.value])} aria-valuetext={`rho ${rho}`} />
          <b className="mono">{rho}</b>
        </label>
        <div className="kv"><span>link capacity</span><b className="mono">{bytes(h.capacity_bytes)}</b></div>
        <div className="kv"><span>HERALD / UB</span><b className="mono">{h.pct_ub !== null ? (100 * h.pct_ub).toFixed(1) : "-"}%</b></div>
        <div className="kv"><span>FIFO / UB</span><b className="mono">{f.pct_ub !== null ? (100 * f.pct_ub).toFixed(1) : "-"}%</b></div>
        <div className="kv"><span>HERALD value</span><b className="mono"><Rupee v={h.value} name="rupees_per_ha" meta={data.meta.rupees_per_ha} value={data.params.rupees_per_ha} /></b></div>
        <div className="kv"><span>FIFO value</span><b className="mono"><Rupee v={f.value} name="rupees_per_ha" meta={data.meta.rupees_per_ha} value={data.params.rupees_per_ha} /></b></div>
        <div className="card">
          <span>Contact minutes saved to 90% of total value</span>
          <b className="mono big">{saved !== null ? `${saved.toFixed(1)} min` : f.minutes_to_90 === null && h.minutes_to_90 !== null ? "FIFO never reaches 90%" : "neither reaches 90%"}</b>
          <span className="mono">FIFO {f.minutes_to_90?.toFixed(1) ?? "n/a"} vs HERALD {h.minutes_to_90?.toFixed(1) ?? "n/a"} min
            {saved !== null && <> = <Rupee v={saved * rpm} name="rupees_per_contact_min" meta={data.meta.rupees_per_contact_min} value={rpm} /></>}</span>
        </div>
      </section>
      <Timeline r={out.results.B1} data={data} title="FIFO (B1)" />
      <Timeline r={out.results.H2} data={data} title="HERALD (H2)" />
      <section className="panel span2">
        <h3>Cumulative realized value <small>{data.wins.length} contact windows</small></h3>
        <Curves out={out} data={data} />
        <div className="legend">{POL.map((q) => <span key={q.id}><i style={{ background: q.color }} />{q.id} {q.name} <b className="mono">{((out.results[q.id].metrics.pct_ub ?? 0) * 100).toFixed(0)}%</b></span>)}
          <span><i className="dash" />upper bound</span></div>
      </section>
    </div>
  );
}
