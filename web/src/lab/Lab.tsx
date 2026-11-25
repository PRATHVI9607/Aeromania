import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "../data";
import { classify } from "./model";
import { worker } from "./tiff";
import { C, P, chipValue, deflateLen, plan, pRel, rgba, tile } from "./lib";
import Pair from "./Pair";
import Point from "./Point";
import "./lab.css";

const SAMPLES = [["blr_construction.tif", "Bengaluru construction lead"], ["hasdeo_mine.tif", "Hasdeo mine expansion"], ["blr_cloudy.tif", "Bengaluru cloudy"]];
const COLORS = ["#c9b458", "#3f9e5a", "#8fbf6a", "#e5694f", "#b07be0", "#d9944a", "#9c7a4a", "#f2a93b", "#4a8fe0", "#6fd3c0"];
const RHO = 5, TOP = 10;
const inr = (v: number) => "Rs " + Math.round(v).toLocaleString("en-IN");
const kb = (b: number) => (b / 1024).toFixed(1) + " KB";

interface Res {
  W: number; H: number; cols: number; rows: number; classes: string[]; probs: number[][]; cloud: number[]; bytes: number[];
  value: number[]; msChip: number; img: HTMLCanvasElement; rate: number;
}

async function analyse(buf: ArrayBuffer, rate: number, progress: (s: string) => void): Promise<Res> {
  progress("reading GeoTIFF");
  const { W, H, planar } = await worker(buf);
  const { chips, cols, rows } = tile(planar, W, H);
  const n = cols * rows;
  if (!n) throw new Error(`${W}x${H} px is smaller than one 64x64 chip.`);
  const img = document.createElement("canvas"); img.width = W; img.height = H;
  img.getContext("2d")!.putImageData(new ImageData(rgba(planar, W, H) as unknown as ImageData["data"], W, H), 0, 0);
  const { probs, cloud, ms, classes } = await classify(chips, n, progress);
  progress("compressing chips");
  const bytes = await Promise.all(Array.from({ length: n }, (_, i) => deflateLen(new Uint8Array(chips.buffer, i * 5 * P * 2, 5 * P * 2))));
  const value = probs.map((p, i) => chipValue(cloud[i], pRel(p, classes), rate));
  return { W, H, cols, rows, classes, probs, cloud, bytes, value, msChip: ms / n, img, rate };
}

const top = (p: number[]) => p.indexOf(Math.max(...p));

function Thumb({ r, i, label, sub }: { r: Res; i: number; label: string; sub: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = r.cols; ref.current!.getContext("2d")!.drawImage(r.img, (i % c) * C, Math.floor(i / c) * C, C, C, 0, 0, C, C);
  }, [r, i]);
  return (
    <div className="lab-th" title={`chip ${i} (row ${Math.floor(i / r.cols)}, col ${i % r.cols}) cloud ${(r.cloud[i] * 100).toFixed(0)}%`}>
      <canvas ref={ref} width={C} height={C} />
      <b className="num">{label}</b><span className="num dim">{sub}</span>
    </div>
  );
}

function Results({ r }: { r: Res }) {
  const base = useRef<HTMLCanvasElement>(null), ov = useRef<HTMLCanvasElement>(null);
  const [cloudOn, setCloudOn] = useState(false), [sel, setSel] = useState<number | null>(null), [hov, setHov] = useState<number | null>(null);
  const n = r.cols * r.rows, tops = useMemo(() => r.probs.map(top), [r]);
  const hist = useMemo(() => { const h = r.classes.map(() => 0); tops.forEach((t) => h[t]++); return h; }, [r, tops]);
  const meanCloud = r.cloud.reduce((a, b) => a + b, 0) / n;
  const total = r.bytes.reduce((a, b) => a + b, 0), cap = total / RHO;
  const pl = useMemo(() => plan(r.value.map((v, i) => ({ value: v, bytes: r.bytes[i] })), cap), [r, cap]);

  useEffect(() => { base.current!.getContext("2d")!.drawImage(r.img, 0, 0); }, [r]);
  useEffect(() => {
    const g = ov.current!.getContext("2d")!; g.clearRect(0, 0, r.W, r.H);
    for (let i = 0; i < n; i++) {
      const x = (i % r.cols) * C, y = Math.floor(i / r.cols) * C, t = tops[i];
      g.globalAlpha = sel === null || sel === t ? 0.38 : 0.05; g.fillStyle = COLORS[t]; g.fillRect(x, y, C, C);
      if (cloudOn) { g.globalAlpha = r.cloud[i] * 0.85; g.fillStyle = "#e8eef5"; g.fillRect(x, y, C, C); }
      g.globalAlpha = 0.5; g.strokeStyle = "#0b0e12"; g.strokeRect(x + 0.5, y + 0.5, C - 1, C - 1);
    }
    if (hov !== null) { g.globalAlpha = 1; g.strokeStyle = "#fff"; g.lineWidth = 3; g.strokeRect((hov % r.cols) * C + 1.5, Math.floor(hov / r.cols) * C + 1.5, C - 3, C - 3); g.lineWidth = 1; }
  }, [r, tops, cloudOn, sel, hov, n]);

  const move = (e: React.MouseEvent) => {
    const b = ov.current!.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * r.W, y = ((e.clientY - b.top) / b.height) * r.H;
    setHov(Math.min(r.cols - 1, Math.floor(x / C)) + Math.min(r.rows - 1, Math.floor(y / C)) * r.cols);
  };
  const h = hov ?? 0, hp = r.probs[h];
  const col = (ids: number[], label: string, pct: number, cls: string) => (
    <div className="lab-col">
      <h3>{label} <span className={`num ${cls}`}>{pct.toFixed(1)}%</span></h3>
      <div className="lab-ths">{ids.slice(0, TOP).map((i, k) => <Thumb key={i} r={r} i={i} label={inr(r.value[i])} sub={`#${k + 1} ${kb(r.bytes[i])}`} />)}</div>
    </div>
  );
  return (
    <>
      <div className="lab-stats">
        <div><b className="num">{n}</b><span>chips</span></div>
        <div><b className="num">{r.msChip.toFixed(2)}</b><span>ms/chip (measured, wasm int8)</span></div>
        <div><b className="num">{(meanCloud * 100).toFixed(1)}%</b><span>mean cloud</span></div>
        <div><b className="num">{r.W}x{r.H}</b><span>px at 10 m</span></div>
      </div>
      <div className="lab-main">
        <div className="lab-map">
          <canvas ref={base} width={r.W} height={r.H} />
          <canvas ref={ov} width={r.W} height={r.H} onMouseMove={move} onMouseLeave={() => setHov(null)} />
        </div>
        <div className="lab-side">
          <label className="lab-tog"><input type="checkbox" checked={cloudOn} onChange={(e) => setCloudOn(e.target.checked)} /> cloud shading</label>
          <div className="lab-hist">
            {r.classes.map((c, k) => (
              <button key={c} className={sel === k ? "on" : ""} onClick={() => setSel(sel === k ? null : k)} title={`${hist[k]} chips: ${c}`}>
                <i style={{ background: COLORS[k] }} /><span>{c}</span>
                <em><u style={{ width: `${(100 * hist[k]) / Math.max(...hist, 1)}%`, background: COLORS[k] }} /></em><b className="num">{hist[k]}</b>
              </button>
            ))}
          </div>
          <div className="lab-hover" data-testid="hover">
            {hov === null ? <span className="dim">hover a chip</span> : <>
              <b>{r.classes[top(hp)]}</b> <span className="num">{(hp[top(hp)] * 100).toFixed(0)}%</span>
              <span className="num dim"> cloud {(r.cloud[h] * 100).toFixed(0)}% · {kb(r.bytes[h])} · {inr(r.value[h])}</span>
            </>}
          </div>
        </div>
      </div>
      <section className="lab-herald" data-testid="herald">
        <h2>10-minute pass at rho={RHO}: {kb(cap)} of {kb(total)}</h2>
        <div className="lab-bars">
          <div title="share of total chip value delivered"><span>HERALD</span><em><u style={{ width: `${pl.heraldPct}%`, background: "var(--acc)" }} /></em><b className="num ok">{pl.heraldPct.toFixed(1)}%</b></div>
          <div title="first chips in row order"><span>FIFO</span><em><u style={{ width: `${pl.fifoPct}%`, background: "var(--mut)" }} /></em><b className="num">{pl.fifoPct.toFixed(1)}%</b></div>
        </div>
        <div className="lab-cols">{col(pl.herald, `HERALD sends first (${pl.herald.length} fit)`, pl.heraldPct, "ok")}{col(pl.fifo, `FIFO (${pl.fifo.length} fit)`, pl.fifoPct, "")}</div>
        <p className="lab-note dim small" title="assumptions">
          value = (1 - cloud) x P(Industrial+Residential+Highway) x Rs {r.rate.toLocaleString("en-IN")}/ha (assumption) x 40.96 ha; bytes = real deflate of the uint16 chip; capacity = total / rho (assumption)
        </p>
      </section>
    </>
  );
}

function Single({ data }: { data: Data }) {
  const [res, setRes] = useState<Res | null>(null), [msg, setMsg] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [name, setName] = useState("");
  const rate = (data.params as any).rupees_per_ha?.A ?? 84000;
  const go = async (get: () => Promise<ArrayBuffer>, nm: string) => {
    setBusy(true); setErr(""); setName(nm); setRes(null);
    try { setRes(await analyse(await get(), rate, setMsg)); } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(false); setMsg("");
  };
  const sample = (f: string) => go(async () => { const r = await fetch(`/samples/${f}`); if (!r.ok) throw new Error(`${f} missing`); return r.arrayBuffer(); }, f);
  const file = (f?: File) => f && go(() => f.arrayBuffer(), f.name);
  return (
    <>
      <div className="lab-in">
        <label className="lab-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); file(e.dataTransfer.files[0]); }}>
          <input type="file" accept=".tif,.tiff" data-testid="file" onChange={(e) => file(e.target.files?.[0])} />
          <b>Drop a GeoTIFF</b><span className="dim small">B02,B03,B04,B08,B11 or 12/13-band S2</span>
        </label>
        <div className="lab-btns">{SAMPLES.map(([f, l]) => <button key={f} disabled={busy} onClick={() => sample(f)}>{l}</button>)}</div>
      </div>
      {busy && <div className="lab-msg num">{name}: {msg}</div>}
      {err && <div className="lab-err" role="alert">{err}</div>}
      {res && <Results r={res} />}
    </>
  );
}

const TABS = [["upload", "Upload"], ["pair", "Change check (2 files)"], ["point", "Point check"]] as const;
export default function Lab({ data }: { data: Data }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("upload");
  return (
    <div className="lab view">
      <h1>Lab: run the onboard AI on real imagery</h1>
      <div className="lab-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "upload" ? <Single data={data} /> : tab === "pair" ? <Pair data={data} /> : <Point data={data} />}
    </div>
  );
}
