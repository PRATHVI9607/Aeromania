import { useState } from "react";
import "./charts.css";

/** Interactive horizontal bars: one or more series per row, hover tooltip, optional click to pick a row. */
export function BarChart({ rows, series, fmt = (v) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 }), unit = "", onPick, active }: {
  rows: { key: string; label: string; vals: number[]; note?: string }[]; series: { name: string; color: string }[]; fmt?: (v: number) => string; unit?: string; onPick?: (key: string) => void; active?: string | null;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; r: typeof rows[number] } | null>(null);
  const mx = Math.max(1e-9, ...rows.flatMap((r) => r.vals));
  return (
    <div className="bc" onMouseLeave={() => setTip(null)}>
      {series.length > 1 && <div className="bcleg">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>}
      {rows.map((r) => (
        <div key={r.key} className={`bcrow ${active === r.key ? "on" : ""} ${onPick ? "pick" : ""}`} tabIndex={onPick ? 0 : undefined} role={onPick ? "button" : undefined}
          onClick={() => onPick?.(r.key)} onKeyDown={(e) => onPick && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(r.key))}
          onMouseMove={(e) => { const b = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); setTip({ x: e.clientX - b.left, y: e.clientY - b.top, r }); }}>
          <span className="bcl trunc">{r.label}</span>
          <span className="bcb">{r.vals.map((v, i) => <i key={i} style={{ width: `${Math.max(0.5, (v / mx) * 100)}%`, background: series[i].color }} />)}</span>
          <span className="bcv mono">{fmt(r.vals[r.vals.length - 1])}{unit}</span>
        </div>))}
      {tip && <div className="bctip" style={{ left: Math.min(tip.x + 12, 220), top: tip.y + 14 }}><b>{tip.r.label}</b>
        {tip.r.vals.map((v, i) => <span key={i}><i style={{ background: series[i].color }} />{series[i].name} <em className="mono">{fmt(v)}{unit}</em></span>)}{tip.r.note && <small>{tip.r.note}</small>}</div>}
    </div>
  );
}

/** Scatter with hover tooltip; click selects. */
export function Scatter({ pts, xLabel, yLabel, fx = (v) => String(v), fy = (v) => String(v), onPick, active }: {
  pts: { key: string; x: number; y: number; label: string; color?: string; note?: string }[]; xLabel: string; yLabel: string; fx?: (v: number) => string; fy?: (v: number) => string; onPick?: (k: string) => void; active?: string | null;
}) {
  const [hv, setHv] = useState<string | null>(null);
  const W = 460, H = 240, p = { l: 52, r: 12, t: 10, b: 36 };
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), py = Math.max(0.02 * Math.abs(Math.max(...ys)), 0.03), y0 = Math.min(...ys) - py, y1 = Math.max(...ys) + py;
  const sx = (v: number) => p.l + ((v - x0) / (x1 - x0 || 1)) * (W - p.l - p.r), sy = (v: number) => H - p.b - ((v - y0) / (y1 - y0 || 1)) * (H - p.t - p.b);
  const h = pts.find((q) => q.key === hv);
  return (
    <div className="sc">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}`}>
        {[0, 0.5, 1].map((f) => <g key={f}><line className="grid" x1={p.l} x2={W - p.r} y1={sy(y0 + f * (y1 - y0))} y2={sy(y0 + f * (y1 - y0))} /><text className="ax" x={p.l - 6} y={sy(y0 + f * (y1 - y0)) + 3} textAnchor="end">{fy(y0 + f * (y1 - y0))}</text>
          <text className="ax" x={sx(x0 + f * (x1 - x0))} y={H - 20} textAnchor="middle">{fx(x0 + f * (x1 - x0))}</text></g>)}
        <text className="ax" x={(W + p.l) / 2} y={H - 4} textAnchor="middle">{xLabel}</text><text className="ax" x={8} y={p.t + 4}>{yLabel}</text>
        {pts.map((q) => <circle key={q.key} cx={sx(q.x)} cy={sy(q.y)} r={active === q.key || hv === q.key ? 7 : 5} fill={q.color ?? "var(--a)"} fillOpacity={active === q.key ? 1 : 0.75} stroke={active === q.key ? "var(--tx)" : "var(--bg)"} strokeWidth={1.5}
          style={{ cursor: onPick ? "pointer" : "default" }} tabIndex={0} onMouseEnter={() => setHv(q.key)} onMouseLeave={() => setHv(null)} onFocus={() => setHv(q.key)} onBlur={() => setHv(null)} onClick={() => onPick?.(q.key)} />)}
      </svg>
      {h && <div className="bctip" style={{ left: `${(sx(h.x) / W) * 100}%`, top: `${(sy(h.y) / H) * 100}%` }}><b>{h.label}</b><span>{xLabel} <em className="mono">{fx(h.x)}</em></span><span>{yLabel} <em className="mono">{fy(h.y)}</em></span>{h.note && <small>{h.note}</small>}</div>}
    </div>
  );
}
