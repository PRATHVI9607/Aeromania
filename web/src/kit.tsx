import { useEffect, useId, useMemo, useRef, useState } from "react";

/** Info popover: click or focus the "i" to read the formula and source for a metric. Esc or outside click closes. */
export function Info({ title, children, label }: { title: string; children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId(), box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const c = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", k); window.addEventListener("mousedown", c);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("mousedown", c); };
  }, [open]);
  return (
    <span className="info" ref={box}>
      <button type="button" className="ibtn" aria-label={label ?? `How ${title} is computed`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>i</button>
      {open && <span className="ipop" id={id} role="dialog"><b>{title}</b>{children}</span>}
    </span>
  );
}

/** KPI card: label, one number, a comparison line, an info popover and an optional click-through. */
export function Kpi({ label, value, sub, info, onClick, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; info?: React.ReactNode; onClick?: () => void; tone?: "ok" | "bad" | "acc" }) {
  const body = (<>
    <span className="klab">{label}{info && <Info title={label}>{info}</Info>}</span>
    <b className={`kval ${tone ?? ""}`}>{value}</b>
    {sub && <span className="ksub">{sub}</span>}
  </>);
  return onClick ? <div className="kpi link" role="link" tabIndex={0} onClick={onClick} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}>{body}</div> : <div className="kpi">{body}</div>;
}

export interface Explain { what: React.ReactNode; why: React.ReactNode; how: React.ReactNode[]; caveats: React.ReactNode[] }
/** Four-part explainer under every view title: what you see, why it matters, how it is computed, where it can mislead. */
export function Explainer({ e, defaultOpen = true }: { e: Explain; defaultOpen?: boolean }) {
  return (
    <details className="expl" open={defaultOpen}>
      <summary>About this view<span className="dim"> what it shows, why it matters, how it is computed, caveats</span></summary>
      <div className="explgrid">
        <section><h4>What you are looking at</h4><p>{e.what}</p></section>
        <section><h4>Why it matters</h4><p>{e.why}</p></section>
        <section><h4>How it is computed</h4><ul>{e.how.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
        <section><h4>Caveats</h4><ul>{e.caveats.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
      </div>
    </details>
  );
}

export function useSort<T>(rows: T[], init: keyof T & string, dir: 1 | -1 = -1) {
  const [k, setK] = useState<string>(init), [d, setD] = useState<1 | -1>(dir);
  const sorted = useMemo(() => [...rows].sort((a: any, b: any) => {
    const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * d;
  }), [rows, k, d]);
  const th = (key: string, label: string, right = true) => (
    <th className={right ? "r" : ""} aria-sort={k === key ? (d === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="thb" onClick={() => (k === key ? setD((d * -1) as 1 | -1) : (setK(key), setD(-1)))}>{label}<i>{k === key ? (d === 1 ? "▲" : "▼") : ""}</i></button>
    </th>);
  return { sorted, th };
}

/** Histogram of values in labelled bins, plain SVG. */
export function Histogram({ values, edges, unit, hi, onBin }: { values: number[]; edges: number[]; unit: string; hi?: number | null; onBin?: (i: number) => void }) {
  const bins = edges.slice(0, -1).map((lo, i) => values.filter((v) => v >= lo && v < edges[i + 1]).length);
  const mx = Math.max(1, ...bins), W = 420, H = 140, p = { l: 32, b: 22, t: 6 }, bw = (W - p.l) / bins.length;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Histogram of lead size in ${unit}`}>
      {[0, 0.5, 1].map((f) => <g key={f}><line className="grid" x1={p.l} x2={W} y1={H - p.b - f * (H - p.b - p.t)} y2={H - p.b - f * (H - p.b - p.t)} /><text className="ax" x={p.l - 4} y={H - p.b - f * (H - p.b - p.t) + 3} textAnchor="end">{Math.round(mx * f)}</text></g>)}
      {bins.map((n, i) => { const h = (n / mx) * (H - p.b - p.t); return (
        <g key={i} onClick={() => onBin?.(i)} className={onBin ? "hbin" : ""}>
          <rect x={p.l + i * bw + 2} y={H - p.b - h} width={bw - 4} height={h} rx={2} className={hi === i ? "hot" : "cold"}><title>{`${edges[i]}-${edges[i + 1]} ${unit}: ${n}`}</title></rect>
          <text className="ax" x={p.l + i * bw + bw / 2} y={H - 8} textAnchor="middle">{edges[i + 1] === Infinity ? `${edges[i]}+` : edges[i]}</text></g>); })}
    </svg>
  );
}

/** Horizontal ranked bars with value labels. */
export function HBars({ rows, fmt, color = "var(--acc)" }: { rows: { label: string; v: number; sub?: string }[]; fmt: (v: number) => string; color?: string }) {
  const mx = Math.max(1e-9, ...rows.map((r) => r.v));
  return (
    <ul className="hbars">{rows.map((r) => (
      <li key={r.label}><span className="trunc" title={r.label}>{r.label}</span><i><b style={{ width: `${(r.v / mx) * 100}%`, background: color }} /></i><span className="mono">{fmt(r.v)}</span></li>))}</ul>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <span>{children}</span>}</div>;
}
