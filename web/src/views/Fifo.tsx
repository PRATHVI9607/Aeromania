import { useEffect, useMemo, useRef, useState } from "react";
import { cssVar, useTheme } from "../theme";
import type { ViewProps } from "./props";
import type { PolicyId, RunOut } from "../types";
import { bytes, inr, pctf } from "../fmt";
import { Rupee } from "../Assume";
import { Skeleton, ViewHead } from "../ui";
import { reduced, useTween } from "../anim";

const POL: { id: PolicyId; name: string; color: string }[] = [
  { id: "B1", name: "FIFO", color: "#7b8794" }, { id: "B2", name: "Cloud filter + FIFO", color: "#9aa5b1" },
  { id: "B3", name: "Value greedy", color: "#52606d" }, { id: "H1", name: "HERALD, full chips by value/byte", color: "#C2410C" },
  { id: "H2", name: "HERALD progressive (fastest first insight)", color: "#D97706" },
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
  const theme = useTheme();
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
      g.fillStyle = cssVar("--panel2"); g.fillRect(0, y * RH, (cap[y] / maxCap) * W, Math.max(RH - 0.5, 0.8));
      let x = 0;
      for (const [i, L] of byWin[y]) {
        const t = data.tiles[i];
        const b = L === 0 ? data.params.level_bytes[0] : L === 1 ? data.params.level_bytes[1] - data.params.level_bytes[0] : (prog ? Math.max(t.full_bytes, data.params.level_bytes[1] + 1) - data.params.level_bytes[1] : Math.max(t.full_bytes, data.params.level_bytes[1] + 1));
        const wd = (b / maxCap) * W;
        g.fillStyle = t.cloud > 0.5 ? "#5b6670" : `hsl(36 ${35 + 20 * L}% ${30 + 30 * Math.min(1, t.sev * 2)}%)`;
        g.fillRect(x, y * RH, Math.max(wd - 0.4, 0.6), Math.max(RH - 0.5, 0.8));
        x += wd;
      }
    }
  }, [r, byWin, data, nw, prog, theme]);
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
      {POL.filter((q) => q.id === hid || q.id === "B1").map((q) => <circle key={q.id} cx={hx} cy={y(at(cum[POL.indexOf(q)], p))} r={4} fill={q.color} stroke="var(--panel)" strokeWidth={1.5} />)}
    </svg>
  );
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
      <div className="span2">
        <ViewHead kicker="Track B" title="Same antenna, same minutes, far more value"
          sub={<>Share of the best possible value (upper bound) delivered at rho 1 / 2 / 5 / 10: HERALD {RHO.map((r) => pu(r, "H1")).join(" / ")} (progressive {RHO.map((r) => pu(r, "H2")).join(" / ")}) vs FIFO {RHO.map((r) => pu(r, "B1")).join(" / ")} vs cloud filter {RHO.map((r) => pu(r, "B2")).join(" / ")}. First insight after capture with HERALD progressive (rho {rho}): {sim?.by_rho?.[rho]?.ttfi_min?.H2?.toFixed(0) ?? "n/a"} min vs FIFO {sim?.by_rho?.[rho]?.ttfi_min?.B1?.toFixed(0) ?? "n/a"} min. <span className="badge">{precomputed ? "results.json (python run)" : "live recompute, edited queries"}</span></>} />
      </div>
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
      {rob && <section className="panel span2">
        <h3>Robustness <small>the win is not an artifact of the assumptions</small></h3>
        <dl className="dl">
          <dt>H1 (full chips only, no packet assumption)</dt><dd className="mono">{rob.H1_vs_B1.toFixed(1)}x FIFO, {rob.H1_vs_B2.toFixed(1)}x cloud-filter FIFO at rho 5</dd>
          <dt>H2 packet-value fraction</dt><dd className="mono">{Object.entries(rob.H2_packet_fraction_sensitivity_rho5).map(([k, v]: any) => `${k}: ${v.H2_vs_B1.toFixed(1)}x`).join(", ")} vs FIFO</dd>
        </dl>
        <p className="muted">{rob.note}</p>
        {sim.headline_note && <p className="muted">{sim.headline_note}</p>}
      </section>}
    </div>
  );
}
