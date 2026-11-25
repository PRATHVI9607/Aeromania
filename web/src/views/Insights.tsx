import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewProps } from "./props";
import type { Tile } from "../types";
import { bytes } from "../fmt";

const N = 46, CELL = 12;
const sevColor = (s: number, valid: boolean) => !valid ? "rgba(90,100,110,.55)" : s < 0.15 ? "rgba(0,0,0,0)" : `hsla(${40 - 40 * s} 90% ${50 + 5 * s}% / ${0.25 + 0.6 * s})`;

function Crop({ src, row, col, size }: { src: string; row: number; col: number; size: number }) {
  return <div className="crop" style={{ width: size, height: size, backgroundImage: `url(${src})`, backgroundSize: `${N * size}px ${N * size}px`, backgroundPosition: `${-col * size}px ${-row * size}px` }} />;
}

export function Insights({ data }: ViewProps) {
  const aois = useMemo(() => [...new Set(data.tiles.map((t) => t.aoi))], [data.tiles]);
  const [aoi, setAoi] = useState(aois[0]);
  const [sel, setSel] = useState<number | null>(null);
  const [stage, setStage] = useState(-1);
  const [imgOk, setImgOk] = useState(true);
  const [split, setSplit] = useState(50);
  const cv = useRef<HTMLCanvasElement>(null);
  // Assumes tiles of one (aoi,date) appear in tile-index order (i = row*46+col), per HANDOFF vault/meta.
  const tiles = useMemo(() => {
    const ts = data.tiles.filter((t) => t.aoi === aoi);
    const date = ts.some((t) => t.date === "t1") ? "t1" : ts[0]?.date;
    return ts.filter((t) => t.date === date);
  }, [data.tiles, aoi]);
  useEffect(() => { setSel(null); setStage(-1); setImgOk(true); }, [aoi]);
  useEffect(() => { setStage(-1); }, [sel]);
  useEffect(() => {
    const g = cv.current!.getContext("2d")!;
    g.clearRect(0, 0, N * CELL, N * CELL);
    tiles.forEach((t, i) => { if (i >= N * N) return; g.fillStyle = sevColor(t.sev, t.cloud < 0.7); g.fillRect((i % N) * CELL, Math.floor(i / N) * CELL, CELL - 1, CELL - 1); });
    if (sel !== null) { g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect((sel % N) * CELL, Math.floor(sel / N) * CELL, CELL - 1, CELL - 1); }
  }, [tiles, sel]);
  const t: Tile | undefined = sel !== null ? tiles[sel] : undefined;
  const row = sel !== null ? Math.floor(sel / N) : 0, col = sel !== null ? sel % N : 0;
  const p = data.params, S = 220;
  const pull = () => { setStage(0); setTimeout(() => setStage(1), 500); setTimeout(() => setStage(2), 1300); };
  const pct = (b: number) => (b / (t?.full_bytes || 1) * 100).toFixed(1);
  return (
    <div className="grid2">
      <section className="panel">
        <h3>AOI tiles <small>
          <select value={aoi} onChange={(e) => setAoi(e.target.value)} aria-label="AOI">{aois.map((a) => <option key={a}>{a}</option>)}</select></small></h3>
        <div className="mosaic" style={{ width: N * CELL, height: N * CELL }}>
          {imgOk && <img src={`/data/img/${aoi}_t1.jpg`} loading="lazy" alt={`${aoi} mosaic`} onError={() => setImgOk(false)} />}
          <canvas ref={cv} width={N * CELL} height={N * CELL}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const c = Math.floor((e.clientX - r.left) / r.width * N), rw = Math.floor((e.clientY - r.top) / r.height * N); setSel(rw * N + c); }} />
        </div>
        {!imgOk && <p className="muted">Mosaic image not generated yet (web/public/data/img/{aoi}_t1.jpg); showing tile grid only.</p>}
        <p className="muted">Severity: transparent low, amber to red high. Grey = cloud over 70%.</p>
      </section>
      <section className="panel">
        <h3>Tile {t ? <small>row {row}, col {col}</small> : <small>select a tile</small>}</h3>
        {t && <>
          <div className="ba" style={{ width: S, height: S }}>
            <Crop src={`/data/img/${aoi}_t0.jpg`} row={row} col={col} size={S} />
            <div className="ov" style={{ clipPath: `inset(0 0 0 ${split}%)`, filter: stage === 0 ? "blur(10px) saturate(.4)" : stage === 1 ? "blur(3px)" : "none" }}>
              <Crop src={`/data/img/${aoi}_t1.jpg`} row={row} col={col} size={S} />
            </div>
            <i className="handle" style={{ left: `${split}%` }} />
          </div>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} aria-label="before after slider" style={{ width: S }} />
          <div className="cap" style={{ width: S }}><span>t0 (before)</span><span>t1 (after)</span></div>
          <dl className="dl">
            <dt>class</dt><dd>{t.cls}</dd><dt>change kind</dt><dd>{t.kind}</dd>
            <dt>severity</dt><dd className="mono">{t.sev.toFixed(2)}</dd><dt>changed area</dt><dd className="mono">{t.ha.toFixed(2)} ha</dd>
            <dt>confidence</dt><dd className="mono">{(t.conf * 100).toFixed(0)}%</dd><dt>cloud</dt><dd className="mono">{(t.cloud * 100).toFixed(0)}%</dd>
          </dl>
          <button className="primary" onClick={pull} disabled={stage >= 0 && stage < 2}>pull full chip</button>
          <ol className="stages">
            {([["packet", p.level_bytes[0]], ["thumbnail", p.level_bytes[1]], ["full chip (zlib proxy for CCSDS-122)", t.full_bytes]] as [string, number][]).map(([n, b], i) => (
              <li key={n} className={stage >= i ? "on" : ""}><span>{n}</span><b className="mono">{stage >= i ? bytes(b) : "-"}</b><span className="mono">{stage >= i ? `${pct(b)}% of full` : ""}</span></li>
            ))}
          </ol>
        </>}
      </section>
    </div>
  );
}
