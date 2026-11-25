import { Explainer, type Explain } from "./kit";
export function ViewHead({ kicker, title, sub, explain }: { kicker: string; title: string; sub?: React.ReactNode; explain?: Explain }) {
  return (
    <header className="vh">
      <div className="kicker">{kicker}</div>
      <h2 className="headline">{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {explain && <Explainer e={explain} />}
    </header>
  );
}

export function Skeleton({ rows = 3, label = "loading" }: { rows?: number; label?: string }) {
  return (
    <div className="skel" role="status" aria-label={label}>
      <i className="sk w30" /><i className="sk w60 tall" />
      {Array.from({ length: rows }, (_, i) => <i key={i} className="sk" style={{ width: `${92 - i * 11}%` }} />)}
    </div>
  );
}

import { Component, useEffect, useRef, useState } from "react";
import { reduced, useTween } from "./anim";

/** Number that counts up from 0 on mount and tweens on change. */
export function Num({ v, f = (x: number) => x.toFixed(0), ms = 700 }: { v: number; f?: (x: number) => string; ms?: number }) {
  const [t, setT] = useState(0);
  useEffect(() => { setT(v); }, [v]);
  return <span className="mono num">{f(useTween(t, ms))}</span>;
}

export function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="stat"><span className="lab">{label}</span><b className="val">{children}</b>{sub && <span className="subv">{sub}</span>}</div>;
}

export const Chip = ({ children, tone, title }: { children: React.ReactNode; tone?: "ok" | "bad" | "warn" | "acc"; title?: string }) =>
  <span className={`chip ${tone ?? ""}`} title={title}>{children}</span>;

/** Before/after compare: drag anywhere, arrow keys (Shift = 10), Home/End. Reveals itself once on mount. */
export function BeforeAfter({ before, after, size = 300, labels }: { before: React.CSSProperties; after: React.CSSProperties; size?: number; labels: [string, string] }) {
  const [p, setP] = useState(reduced() ? 50 : 96);
  const el = useRef<HTMLDivElement>(null), touched = useRef(false);
  useEffect(() => {
    if (reduced()) return;
    let raf = 0; const t0 = performance.now();
    const step = (n: number) => { if (touched.current) return; const k = Math.min(1, (n - t0) / 900); setP(96 - 46 * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  const at = (cx: number) => { const r = el.current!.getBoundingClientRect(); touched.current = true; setP(Math.max(0, Math.min(100, ((cx - r.left) / r.width) * 100))); };
  return (
    <div className="ba" ref={el} style={{ width: size, height: size }} tabIndex={0} role="slider" aria-label="Before and after" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}
      aria-valuetext={`${Math.round(p)} percent before, ${Math.round(100 - p)} percent after`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e.clientX); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e.clientX); }}
      onKeyDown={(e) => {
        const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
        if (d) { e.preventDefault(); touched.current = true; setP((v) => Math.max(0, Math.min(100, v + d * (e.shiftKey ? 10 : 2)))); }
        else if (e.key === "Home") { touched.current = true; setP(0); } else if (e.key === "End") { touched.current = true; setP(100); }
      }}>
      <div className="crop" style={before} />
      <div className="crop" style={{ ...after, clipPath: `inset(0 0 0 ${p}%)` }} />
      <span className="tag l">{labels[0]}</span><span className="tag r">{labels[1]}</span>
      <i className="handle" style={{ transform: `translateX(${(p / 100) * size}px)` }}><b /></i>
    </div>
  );
}


/** Error boundary: a view (or a WebGL globe) that fails to start shows a notice instead of blanking the whole app. */
export class Guard extends Component<{ label: string; children: React.ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? e.message : String(e) }; }
  componentDidCatch(e: unknown) { console.warn(`[${this.props.label}]`, e); }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="card guard" role="alert"><b>{this.props.label} could not start on this device.</b>
      <p className="muted">{/webgl|cesiumwidget/i.test(this.state.err) ? "This view needs WebGL. Try Chrome with hardware acceleration on; every other view still works." : this.state.err}</p></div>;
  }
}
