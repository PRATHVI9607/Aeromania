import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewProps } from "./props";
import type { PolicyId, RunOut, Tile } from "../types";
import { bytes, inr, pctf } from "../fmt";
import { Rupee } from "../Assume";
import { Skeleton } from "../ui";
import { Info } from "../kit";
import "./fifo.css";
import { reduced, useTween } from "../anim";

const POL: { id: PolicyId; name: string; color: string }[] = [
  { id: "B1", name: "FIFO", color: "#8A97A8" }, { id: "B2", name: "Cloud filter + FIFO", color: "#B4BFCC" },
  { id: "B3", name: "Value greedy", color: "#5B6B80" }, { id: "H1", name: "HERALD, full chips by value/byte", color: "#22D3EE" },
  { id: "H2", name: "HERALD progressive (fastest first insight)", color: "#67E8F9" },
];
const TH = 300, RACE_S = 10; // timeline canvas height px; race duration seconds
const RHO = [1, 2, 5, 10];

/** value of a per-window cumulative array at fractional window progress p */
function at(a: ArrayLike<number>, p: number) {
  const n = a.length; if (!(p >= 0)) return 0; if (p >= n) return a[n - 1] ?? 0;
  const i = Math.floor(p), lo = i === 0 ? 0 : a[i - 1];
  return lo + (a[i] - lo) * (p - i);
}

function Timeline({ r, data, title, p, tone, value, ub, prog }: { prog: boolean; r: RunOut; data: ViewProps["data"]; title: string; p: number; tone: string; value: number; ub: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nw = data.wins.length;
  const byWin = useMemo(() => {
    const m: [number, number][][] = Array.from({ length: nw }, () => []);
    for (const [i, L, w] of r.sel) m[w].push([i, L]);
    return m;
  }, [r, nw]);
  useEffect(() => {
    const c = ref.current!, dpr = devicePixelRatio || 1, W = c.clientWidth, RH = TH / nw;
    c.width = W * dpr; c.height = TH * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr);
    const cap = r.timeline.cap, maxCap = Math.max(...cap, 1);
    for (let y = 0; y < nw; y++) {
      g.fillStyle = "#152030"; g.fillRect(0, y * RH, (cap[y] / maxCap) * W, Math.max(RH - 0.5, 0.8));
      let x = 0;
      for (const [i, L] of byWin[y]) {
        const t = data.tiles[i];
        const b = L === 0 ? data.params.level_bytes[0] : L === 1 ? data.params.level_bytes[1] - data.params.level_bytes[0] : (prog ? Math.max(t.full_bytes, data.params.level_bytes[1] + 1) - data.params.level_bytes[1] : Math.max(t.full_bytes, data.params.level_bytes[1] + 1));
        const wd = (b / maxCap) * W;
        g.fillStyle = t.cloud > 0.5 ? "#5B6B80" : `hsl(187 ${55 + 15 * L}% ${28 + 30 * Math.min(1, t.sev * 2)}%)`;
        g.fillRect(x, y * RH, Math.max(wd - 0.4, 0.6), Math.max(RH - 0.5, 0.8));
        x += wd;
      }
    }
  }, [r, byWin, data, nw, prog]);
  return (
    <div className="panel racepanel">
      <h3>{title} <small>{bytes(at(r.timeline.bytes.reduce<number[]>((a, v) => (a.push((a[a.length - 1] ?? 0) + v), a), []), p))} sent</small></h3>
      <div className="tickrow"><b className={`mono big ${tone}`}>{inr(value)}</b><span className="mono dim">{pctf(ub > 0 ? value / ub : null, 1)} of upper bound</span></div>
      <div className="tlwrap" style={{ height: TH }}>
        <canvas ref={ref} style={{ width: "100%", height: TH }} aria-label={`${title} per-window byte timeline`} />
        <i className="mask" style={{ transform: `translateY(${(Math.min(p, nw) / nw) * 100}%)` }} />
      </div>
      <div className="cap"><span>first contact</span><span>window {Math.min(nw, Math.ceil(p))} of {nw}</span><span>last contact</span></div>
    </div>
  );
}

function Curves({ cum, ub, data, p, hid }: { cum: number[][]; ub: number; data: ViewProps["data"]; p: number; hid: PolicyId }) {
  const W = 1300, H = 300, m = { l: 90, r: 12, t: 14, b: 24 };
  const wins = data.wins, nw = wins.length;
  const t0 = wins[0].start_min, t1 = wins[nw - 1].end_min;
  const ymax = Math.max(ub, 1) * 1.05;
  const x = (t: number) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const days = Math.floor((t1 - t0) / 1440);
  const ends = useMemo(() => wins.map((w) => w.end_min), [wins]);
  const tAt = (q: number) => (q >= nw ? t1 : q <= 0 ? t0 : (q < 1 ? t0 : ends[Math.floor(q) - 1]) + ((ends[Math.floor(q)] - (q < 1 ? t0 : ends[Math.floor(q) - 1])) * (q - Math.floor(q))));
  const paths = useMemo(() => cum.map((cv) => `M${x(t0)},${y(0)}` + cv.map((v, i) => `L${x(ends[i]).toFixed(1)},${y(v).toFixed(1)}`).join("")), [cum, ub]); // eslint-disable-line
  const hx = x(tAt(p));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Cumulative realized value by policy">
      <defs><clipPath id="reveal"><rect x={0} y={0} width={hx} height={H} /></clipPath></defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}><line x1={m.l} x2={W - m.r} y1={y(f * ymax)} y2={y(f * ymax)} className="grid" />
          <text x={m.l - 6} y={y(f * ymax) + 3} textAnchor="end" className="ax">{inr(f * ymax)}</text></g>
      ))}
      {Array.from({ length: days + 1 }, (_, d) => <text key={d} x={x(t0 + d * 1440)} y={H - 6} textAnchor="middle" className="ax">day {d}</text>)}
      <line x1={m.l} x2={W - m.r} y1={y(ub)} y2={y(ub)} className="ub" />
      <text x={W - m.r} y={y(ub) - 4} textAnchor="end" className="ax">upper bound (relaxation)</text>
      <g clipPath="url(#reveal)">
        {POL.map((q, k) => <path key={q.id} d={paths[k]} fill="none" stroke={q.color} strokeWidth={q.id === hid ? 2.8 : q.id === "B1" ? 1.8 : 1.2} opacity={q.id === hid || q.id === "B1" ? 1 : 0.55} />)}
      </g>
      <line x1={hx} x2={hx} y1={m.t} y2={H - m.b} className="cursor" />
      {POL.filter((q) => q.id === hid || q.id === "B1").map((q) => <circle key={q.id} cx={hx} cy={y(at(cum[POL.indexOf(q)], p))} r={4} fill={q.color} stroke="#0A0E14" strokeWidth={1.5} />)}
    </svg>
  );
}


const T = (a: Tile) => a.cloud > 0.5 ? "cloud" : a.kind === "none" ? "empty" : "value";
const KC: Record<string, string> = { cloud: "#5B6B80", empty: "#22304A", value: "#F5A524" };
/** satellite queue -> antenna -> ground, tiles stream along the link; FIFO sends in arrival order, HERALD only what is worth the bytes */
function Flow({ kinds, title, tone }: { kinds: string[]; title: string; tone: "F" | "H" }) {
  return (
    <figure className={`flow ${tone}`} aria-label={title}>
      <figcaption>{title}</figcaption>
      <svg viewBox="0 0 320 84" width="100%" role="img">
        <rect x="6" y="26" width="34" height="32" rx="4" className="fs" /><rect x="0" y="36" width="6" height="12" className="fp" /><rect x="40" y="36" width="6" height="12" className="fp" />
        <path d="M150 64 L168 36 A22 22 0 0 0 150 64 Z" className="fd" /><path d="M158 52 V70 M148 70 H168" className="fd2" />
        <rect x="262" y="40" width="52" height="30" rx="4" className="fg" /><text x="288" y="59" textAnchor="middle" className="ft">ground</text>
        <line x1="46" x2="262" y1="42" y2="42" className="fl" />
        {kinds.map((k, i) => <rect key={i} x="48" y="38" width="8" height="8" rx="1.5" fill={KC[k]} className="pk" style={{ animationDelay: `${(i * 3.6) / kinds.length}s` }} />)}
      </svg>
    </figure>
  );
}
function Why({ k, v, sub, tone }: { k: string; v: string; sub: string; tone?: string }) {
  return <div className="why"><span className="klab">{k}</span><b className={`kval ${tone ?? ""}`}>{v}</b><span className="ksub">{sub}</span></div>;
}

export function Fifo({ data, out: live, rho, setRho, queries }: ViewProps & { setRho: (n: number) => void }) {
  const nw = data.wins.length;
  const [p, setP] = useState(reduced() ? nw : 0), [playing, setPlaying] = useState(!reduced());
  const pr = useRef(reduced() ? nw : 0);
  const [hid, setHid] = useState<PolicyId>("H1");
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      pr.current = Math.min(nw, pr.current + ((now - last) / 1000) * (nw / RACE_S)); last = now; setP(pr.current);
      if (pr.current >= nw) setPlaying(false); else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, nw]);
  const play = () => { if (reduced()) { pr.current = nw; setP(nw); return; } if (pr.current >= nw) { pr.current = 0; setP(0); } setPlaying(!playing); };

  // Precomputed results.json while queries are unchanged (python run); live worker recompute once edited.
  const pre = data.results?.by_rho?.[String(rho)];
  const precomputed = !!pre && queries === data.queries;
  const out = useMemo(() => (live ? (precomputed ? { ...live, results: pre } : live) : null), [live, pre, precomputed]);
  // one flat array so a rho change morphs every curve and counter together
  const flat = useMemo(() => out ? [...POL.flatMap((q) => out.results[q.id].timeline.cum_value), out.results.B1.metrics.ub] : [], [out]);
  const tw = useTween(flat, 600);
  const mix = useMemo(() => { const c = { value: 0, cloud: 0, empty: 0 }; for (const t of data.tiles) c[T(t) as "value"]++; return c; }, [data.tiles]);
  const nt = data.tiles.length, mixPct = { value: +(100 * mix.value / nt).toFixed(1), cloud: +(100 * mix.cloud / nt).toFixed(1), empty: +(100 * mix.empty / nt).toFixed(1) };
  // 60 squares in the real proportions, spread with a stride so the queue looks arrival-ordered, not sorted
  const mixSeq = useMemo(() => { const nv = Math.max(1, Math.round((60 * mix.value) / nt)), nc = Math.round((60 * mix.cloud) / nt); return Array.from({ length: 60 }, (_, i) => { const v = (i * 7) % 60; return v < nv ? "value" : v < nv + nc ? "cloud" : "empty"; }); }, [mix, nt]);
  const fifoSeq = useMemo(() => mixSeq.slice(0, 12), [mixSeq]), herSeq = useMemo(() => Array.from({ length: 6 }, () => "value"), []);
  const wasteB = useMemo(() => { let w = 0; for (const [i] of live?.results.B1.sel ?? []) { const t = data.tiles[i]; if (T(t) !== "value") w += Math.max(t.full_bytes, data.params.level_bytes[1] + 1); } return w; }, [live, data]);
  if (!live || !out || !nw || tw.length !== flat.length) return <Skeleton label="scheduling" rows={6} />;
  const cum = POL.map((_, k) => tw.slice(k * nw, (k + 1) * nw)), ubT = tw[tw.length - 1];
  const f = out.results.B1.metrics, h = out.results[hid].metrics;
  const sim = data.reports.sim, rob = sim?.robustness;
  // % of upper bound, not ratios: FIFO can approach 0 at high rho, which makes a ratio explode and mislead
  const pu = (r: number, q: string) => { const v = data.results?.by_rho?.[String(r)]?.[q]?.metrics?.pct_ub; return typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "n/a"; };
  const sr = sim?.by_rho?.[rho];
  const match = { h: (sr?.minutes_to_match_fifo?.H2 ?? null) as number | null, f: (sr?.fifo_minutes_used ?? null) as number | null };
  const saved = match.h !== null && match.f !== null ? match.f - match.h : null;
  const rpm = data.params.rupees_per_contact_min;
  const vH = at(cum[POL.findIndex((q) => q.id === hid)], p), vF = at(cum[0], p);
  return (
    <div className="grid2">
      <section className="span2 strip">
        <h2 className="vt">Same antenna, same minutes, far more value
          <Info title="FIFO vs HERALD"><b>What</b> FIFO sends tiles in arrival order. HERALD ranks every tile by value per byte and sends the best first. <b>Why</b> contact time is the scarce resource: spending it on cloud or unchanged tiles delays the answers that matter.</Info></h2>
        <div className="flows">
          <figure className="flow q"><figcaption>1 On board: the queue</figcaption>
            <div className="mix" aria-label="tile mix">{mixSeq.map((k, i) => <i key={i} style={{ background: KC[k] }} />)}</div>
            <div className="mixl"><span><i style={{ background: KC.value }} />value {mixPct.value}%</span><span><i style={{ background: KC.cloud }} />cloud {mixPct.cloud}%</span><span><i style={{ background: KC.empty }} />no change {mixPct.empty}%</span></div></figure>
          <Flow kinds={fifoSeq} title="2 FIFO: arrival order" tone="F" />
          <Flow kinds={herSeq} title="3 HERALD: value per byte first" tone="H" />
        </div>
      </section>
      <section className="span2 bar">
        <button className="primary playbtn" onClick={play} aria-label="play the downlink race">{playing ? "Pause" : p >= nw ? (nw ? "Play race" : "") : "Resume"}</button>
        <label className="grow">Race
          <input type="range" min={0} max={nw} step={0.1} value={p} aria-label="race progress" onChange={(e) => { setPlaying(false); pr.current = +e.target.value; setP(pr.current); }} />
        </label>
        <div className="seg" role="group" aria-label="HERALD variant">{(["H1", "H2"] as PolicyId[]).map((id) => <button key={id} className={hid === id ? "on" : ""} aria-pressed={hid === id} onClick={() => setHid(id)}>{id === "H1" ? "Value (H1)" : "First insight (H2)"}</button>)}</div>
        <label>Oversubscription rho
          <input type="range" min={0} max={3} step={1} value={RHO.indexOf(rho)} onChange={(e) => setRho(RHO[+e.target.value])} aria-valuetext={`rho ${rho}`} />
          <b className="mono">{rho}</b>
        </label>
        <div className="kv"><span>link capacity</span><b className="mono">{bytes(h.capacity_bytes)}</b></div>
        <div className="kv"><span>{hid} / UB</span><b className="mono">{h.pct_ub !== null ? (100 * h.pct_ub).toFixed(1) : "-"}%</b></div>
        <div className="kv"><span>FIFO / UB</span><b className="mono">{f.pct_ub !== null ? (100 * f.pct_ub).toFixed(1) : "-"}%</b></div>
        <div className="card">
          <span>Contact minutes for HERALD to match FIFO's final value</span>
          <b className="mono big">{match.h !== null ? `${match.h.toFixed(1)} min` : "n/a"}</b>
          <span className="mono">FIFO used {match.f !== null ? match.f.toFixed(0) : "n/a"} min{saved !== null && <> : saves {saved.toFixed(0)} min = <Rupee v={saved * rpm} name="rupees_per_contact_min" meta={data.meta.rupees_per_contact_min} value={rpm} /></>}</span>
        </div>
      </section>
      <div key={`f${rho}`} className="fade"><Timeline r={live.results.B1} data={data} title="FIFO (B1)" prog={false} p={p} tone="" value={vF} ub={ubT} /></div>
      <div key={`h${rho}${hid}`} className="fade"><Timeline r={live.results[hid]} data={data} title={hid === "H1" ? "HERALD (H1, full chips by value/byte)" : "HERALD progressive (H2)"} prog={hid === "H2"} p={p} tone="accent" value={vH} ub={ubT} /></div>
      <section className="panel span2">
        <h3>Cumulative realized value <small>{nw} contact windows, curves draw in step with the race</small></h3>
        <Curves cum={cum} ub={ubT} data={data} p={p} hid={hid} />
        <div className="legend">{POL.map((q) => <span key={q.id}><i style={{ background: q.color }} />{q.id} {q.name} <b className="mono">{((out.results[q.id].metrics.pct_ub ?? 0) * 100).toFixed(0)}%</b></span>)}
          <span><i className="dash" />upper bound</span></div>
      </section>
      <section className="span2 whys" aria-label="Why it matters">
        <Why k="Tiles that carry value" v={`${mixPct.value}%`} sub={`${mix.value.toLocaleString("en-IN")} of ${nt.toLocaleString("en-IN")}; the rest is cloud (${mixPct.cloud}%) or unchanged (${mixPct.empty}%)`} tone="acc" />
        <Why k="FIFO bytes spent on cloud or no change" v={`${f.bytes_sent > 0 ? ((100 * wasteB) / f.bytes_sent).toFixed(0) : "0"}%`} sub={`${bytes(wasteB)} of ${bytes(f.bytes_sent)} sent at rho ${rho}`} tone="bad" />
        <Why k="First insight after capture" v={`${out.results.H2.metrics.ttfi_min?.toFixed(0) ?? "n/a"} min`} sub={`HERALD progressive; FIFO needs ${f.ttfi_min?.toFixed(0) ?? "n/a"} min`} tone="ok" />
      </section>
      {rob && <section className="panel span2">
        <details className="how"><summary>How it works and robustness</summary>
          <dl className="dl">
            <dt>H1, full chips only</dt><dd className="mono">{rob.H1_vs_B1.toFixed(1)}x FIFO, {rob.H1_vs_B2.toFixed(1)}x cloud-filter FIFO at rho 5</dd>
            <dt>H2 packet-value fraction</dt><dd className="mono">{Object.entries(rob.H2_packet_fraction_sensitivity_rho5).map(([k, v]: any) => `${k}: ${v.H2_vs_B1.toFixed(1)}x`).join(", ")} vs FIFO</dd>
            <dt>Source</dt><dd><span className="badge">{precomputed ? "results.json (python run)" : "live recompute, edited queries"}</span></dd>
          </dl>
          <p className="muted">{rob.note}</p>{sim.headline_note && <p className="muted">{sim.headline_note}</p>}
        </details>
      </section>}
    </div>
  );
}
