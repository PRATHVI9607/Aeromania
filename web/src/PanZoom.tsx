import { useEffect, useRef, useState } from "react";

const KMAX = 10;
/** Pan and zoom surface: wheel, drag, pinch, double-tap or double-click, +/- buttons. Children get the scale so markers can stay a constant size. */
export function PanZoom({ children, className = "mosaic" }: { children: (k: number) => React.ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [v, setV] = useState({ k: 1, x: 0, y: 0, anim: false });
  const vr = useRef(v); vr.current = v;
  const fit = (k: number, x: number, y: number, anim = false) => {
    const b = box.current!.getBoundingClientRect(); k = Math.min(KMAX, Math.max(1, k));
    return { k, x: Math.min(0, Math.max(b.width * (1 - k), x)), y: Math.min(0, Math.max(b.height * (1 - k), y)), anim };
  };
  const zoomAt = (f: number, cx: number, cy: number, anim = false) => { const { k, x, y } = vr.current, nk = Math.min(KMAX, Math.max(1, k * f)), r = nk / k; setV(fit(nk, cx - (cx - x) * r, cy - (cy - y) * r, anim)); };
  const mid = () => { const b = box.current!.getBoundingClientRect(); return [b.width / 2, b.height / 2]; };
  useEffect(() => {
    const el = box.current!;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const b = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - b.left, e.clientY - b.top, true); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const ptrs = useRef(new Map<number, [number, number]>()), moved = useRef(0), last = useRef({ t: 0, x: 0, y: 0 }), pin = useRef(0);
  const down = (e: React.PointerEvent) => {
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.current.size === 1) moved.current = 0;
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; pin.current = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  };
  const move = (e: React.PointerEvent) => {
    const p = ptrs.current.get(e.pointerId); if (!p) return;
    const b = box.current!.getBoundingClientRect();
    if (ptrs.current.size === 2) {
      ptrs.current.set(e.pointerId, [e.clientX, e.clientY]); const [a, c] = [...ptrs.current.values()], d = Math.hypot(a[0] - c[0], a[1] - c[1]);
      if (pin.current > 0) zoomAt(d / pin.current, (a[0] + c[0]) / 2 - b.left, (a[1] + c[1]) / 2 - b.top); pin.current = d; moved.current = 99; return;
    }
    const dx = e.clientX - p[0], dy = e.clientY - p[1]; moved.current += Math.abs(dx) + Math.abs(dy);
    if (moved.current > 4) { if (!box.current!.hasPointerCapture(e.pointerId)) box.current!.setPointerCapture(e.pointerId); const { k, x, y } = vr.current; setV(fit(k, x + dx, y + dy)); ptrs.current.set(e.pointerId, [e.clientX, e.clientY]); }
  };
  const up = (e: React.PointerEvent) => {
    const wasTap = moved.current <= 4 && ptrs.current.size === 1; ptrs.current.delete(e.pointerId);
    if (wasTap && e.pointerType === "touch") { // double-tap (touch fires no reliable dblclick)
      const n = performance.now(), b = box.current!.getBoundingClientRect();
      if (n - last.current.t < 320 && Math.hypot(e.clientX - last.current.x, e.clientY - last.current.y) < 24) { zoomAt(vr.current.k > 2 ? 1 / vr.current.k : 2.2, e.clientX - b.left, e.clientY - b.top, true); last.current.t = 0; }
      else last.current = { t: n, x: e.clientX, y: e.clientY };
    }
  };
  return (
    <div className={`${className} pz`} ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={(e) => { const b = box.current!.getBoundingClientRect(); zoomAt(2, e.clientX - b.left, e.clientY - b.top, true); }}
      onClickCapture={(e) => { if (moved.current > 4) { e.stopPropagation(); moved.current = 0; } }}>
      <div className={`zoomer ${v.anim ? "anim" : ""}`} style={{ transform: `translate(${v.x}px,${v.y}px) scale(${v.k})` }}>{children(v.k)}</div>
      <div className="pzb" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button aria-label="Zoom in" onClick={() => { const [x, y] = mid(); zoomAt(1.6, x, y, true); }}>+</button>
        <button aria-label="Zoom out" onClick={() => { const [x, y] = mid(); zoomAt(1 / 1.6, x, y, true); }}>{"−"}</button>
        <button aria-label="Reset zoom" onClick={() => setV(fit(1, 0, 0, true))} disabled={v.k === 1}>1:1</button>
      </div>
      {v.k > 1 && <span className="pzk mono">{v.k.toFixed(1)}x</span>}
    </div>
  );
}
