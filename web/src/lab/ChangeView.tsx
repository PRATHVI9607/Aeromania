import { FOREST_MIN_SHARE } from "./change";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Chip } from "./Cards";
import { canvasOf, type PairRes } from "./pair";
import type { ReactNode } from "react";

const MASKS: [keyof PairRes["change"], string, string][] = [["cleared", "#f2a93b", "cleared / earthwork"], ["built", "#e5694f", "built-up"], ["forest", "#6fd3c0", "forest loss"], ["mine", "#b07be0", "mine expansion"]];
const f1 = (v: number) => v.toFixed(2);

export function ChangeView({ r, rate, a2 }: { r: PairRes; rate: number; a2?: ReactNode }) {
  const [pos, setPos] = useState(50), [mask, setMask] = useState(true);
  const host = useRef<HTMLDivElement>(null), ov = useRef<HTMLCanvasElement>(null);
  const cv = useMemo(() => ({ b: canvasOf(r.p0, r.W, r.H), a: canvasOf(r.p1, r.W, r.H) }), [r]);
  useEffect(() => {
    const h = host.current!; h.replaceChildren(cv.a, cv.b);
    for (const c of [cv.a, cv.b]) Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", imageRendering: "pixelated" });
  }, [cv]);
  useEffect(() => { cv.b.style.clipPath = `inset(0 ${100 - pos}% 0 0)`; }, [cv, pos]);
  useEffect(() => {
    const g = ov.current!.getContext("2d")!, im = g.createImageData(r.W, r.H);
    for (const [k, col] of MASKS) {
      const m = r.change[k] as Uint8Array, v = parseInt(col.slice(1), 16);
      for (let p = 0; p < m.length; p++) if (m[p]) { im.data[p * 4] = v >> 16; im.data[p * 4 + 1] = (v >> 8) & 255; im.data[p * 4 + 2] = v & 255; im.data[p * 4 + 3] = 210; }
    }
    g.putImageData(im, 0, 0);
  }, [r]);
  const { ha } = r.change, cons = ha.construction > 0, loss = ha.forestLoss + ha.mine > 0;
  const isForest = r.change.forestShare >= FOREST_MIN_SHARE;
  return (
    <>
      <div className="lab-stats">
        <div><b className="num">{r.chips}</b><span>chips x 2 dates</span></div>
        <div><b className="num">{r.ms.toFixed(2)}</b><span>ms/chip</span></div>
        <div><b className="num">{(r.cloud0 * 100).toFixed(0)}% / {(r.cloud1 * 100).toFixed(0)}%</b><span>cloud before / after</span></div>
        <div className="lab-mix">{r.classes.map((c, k) => r.mix[k] > 0 && <Chip key={c}>{c} {r.mix[k]}</Chip>)}</div>
      </div>
      <div className="lab-main">
        <div className="lab-swwrap">
          <div className="lab-map lab-sw" data-testid="swipe">
            <div ref={host} style={{ position: "absolute", inset: 0 }} />
            <canvas ref={ov} width={r.W} height={r.H} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", imageRendering: "pixelated", opacity: mask ? 1 : 0, pointerEvents: "none" }} />
            <i className="lab-split" style={{ left: `${pos}%` }} />
          </div>
          <input className="lab-range" type="range" min={0} max={100} value={pos} onChange={(e) => setPos(+e.target.value)} aria-label="swipe before / after" />
        </div>
        <div className="lab-side">
          <Chip>rule-based leads, not verdicts</Chip>
          <label className="lab-tog"><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /> change mask</label>
          <div className="lab-mix">{MASKS.map(([, c, l]) => <span key={l} className="lab-chip dim"><i style={{ background: c }} />{l}</span>)}</div>
        </div>
      </div>
      {/* C applies only where the before image has real canopy; otherwise crop-field greening/harvest would read as forest loss */}
      <div className="lab-cards">
        <Card code="A1" title="Construction" verdict={cons ? (isForest ? "Land cleared in a forest area (see C)" : "New construction detected") : "No change"} tone={cons ? "warn" : "ok"}
          rows={[["new built-up/cleared", `${f1(ha.construction)} ha`], ["cleared / earthwork", `${f1(ha.cleared)} ha`], ["built-up", `${f1(ha.built)} ha`], ["tax at Rs " + rate.toLocaleString("en-IN") + "/ha (assumption)", cons ? "Rs " + Math.round(ha.construction * rate).toLocaleString("en-IN") : "0"]]} />
        <Card code="C" title="Forest / mining" verdict={!isForest ? "Not a forest area" : ha.mine > 0 ? "Mine expansion detected" : ha.forestLoss > 0 ? "Forest loss detected" : "No change"} tone={isForest && loss ? "bad" : "ok"}
          rows={[["contiguous canopy at t0", `${(r.change.forestShare * 100).toFixed(0)}% of area`], ["forest loss", `${f1(ha.forestLoss)} ha`], ["mine expansion", `${f1(ha.mine)} ha`], ["mean dNDVI, forest px", r.change.dndviForest.toFixed(3)]]} />
        {a2 ?? <Card code="A2" title="Solar suitability (proxy)" verdict={r.solar.share >= 0.5 ? "Open land, solar-suitable" : "Limited open land"} tone={r.solar.share >= 0.5 ? "ok" : "warn"}
          rows={[["open usable land", `${f1(r.solar.usableHa)} ha`], ["share of valid area", `${(r.solar.share * 100).toFixed(0)}%`], ["~MW at 1.8 ha/MW", f1(r.solar.usableHa / 1.8)], ["slope, grid", "unknown"]]} />}
      </div>
    </>
  );
}
