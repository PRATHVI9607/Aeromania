import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "../data";
import { useSched } from "../useSched";
import { levelBytes, tileValue } from "../value";
import { bytes as fbytes, hm, inr } from "../fmt";
import type { RunOut, Tile, Window } from "../types";
import { fits, linkBudget, RE, MU, within } from "./link";
import { infer, getSession, loadSample, rgbChip, TOL, type ChipOut, type Sample } from "./onnx";
import "./deep.css";

const LEVELS = ["packet", "thumb", "full"];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/* ---------------------------------------------------------------- 1. live onboard inference */
function ChipCanvas({ s, ci }: { s: Sample; ci: number }) {
  const r = useRef<HTMLCanvasElement>(null);
  useEffect(() => { r.current?.getContext("2d")?.putImageData(rgbChip(s, ci), 0, 0); }, [s, ci]);
  return <canvas ref={r} width={64} height={64} aria-hidden />;
}

function Inference() {
  const [s, setS] = useState<Sample | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [threads, setThreads] = useState(1);
  const [sel, setSel] = useState(0);
  const [outs, setOuts] = useState<Record<number, ChipOut>>({});
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<{ msPerChip: number; n: number; runs: number } | null>(null);
  const [single, setSingle] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    loadSample().then((x) => !dead && setS(x), (e) => !dead && setErr(String(e.message ?? e)));
    // session creation parses the 11 MB model: start it when the browser is idle so the UI paints first
    const go = () => getSession().then((r) => { if (!dead) { setLoadMs(r.loadMs); setThreads(r.threads); } }, (e) => !dead && setErr(`onnxruntime-web could not load the model: ${e?.message ?? e}`));
    const id = (window as any).requestIdleCallback ? (window as any).requestIdleCallback(go) : setTimeout(go, 50);
    return () => { dead = true; (window as any).cancelIdleCallback?.(id); };
  }, []);

  const guard = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e: any) { setErr(`inference failed: ${e?.message ?? e}`); } finally { setBusy(false); } };
  const runOne = (ci: number) => guard(async () => {
    await infer(s!, [ci]); // warm-up, not reported
    const { outs: o, totalMs } = await infer(s!, [ci]);
    setOuts((p) => ({ ...p, [ci]: o[0] })); setSingle(totalMs);
  });
  const runAll = () => guard(async () => {
    const all = s!.chips.map((_, i) => i);
    await infer(s!, all); // warm-up
    const t: number[] = []; let last: ChipOut[] = [];
    for (let k = 0; k < 3; k++) { const r = await infer(s!, all); t.push(r.totalMs); last = r.outs; }
    t.sort((a, b) => a - b);
    setOuts(Object.fromEntries(last.map((o, i) => [i, o])));
    setBatch({ msPerChip: t[1] / all.length, n: all.length, runs: t.length });
  });

  const nOk = Object.values(outs).filter((o) => o.match).length, nRun = Object.keys(outs).length;
  const worst = Object.values(outs).reduce((m, o) => Math.max(m, o.maxDiff), 0);
  const chip = s?.chips[sel], out = outs[sel];
  const top = (p: number[]) => p.map((v, i) => [i, v] as const).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const shown = out ? out.probs : chip?.ground.probs;

  return (
    <section className="deep-sec" aria-labelledby="deep-inf-h">
      <header><span className="deep-n">B1</span><h3 id="deep-inf-h">Onboard AI, running live in this tab</h3></header>
      <p className="deep-lede">The same int8 network that would fly runs here on real Sentinel-2 chips (5 bands, 64 x 64). Click a chip, or run all of them. Each result is checked against the run we recorded on the reference machine.</p>
      {err && <div className="deep-err" role="alert"><b className="deep-bad">Model not running.</b> {err}<br /><span className="deep-dim">Showing the recorded ground run for each chip instead.</span></div>}
      <div className="deep-big">
        <div><b>{batch ? batch.msPerChip.toFixed(2) : "--"}<small style={{ fontSize: 16 }}> ms/chip</small></b><span>batch of {batch?.n ?? 48}, median of {batch?.runs ?? 3} runs: measured in your browser, int8 ONNX, WebAssembly</span></div>
        <div><b style={{ fontSize: 28, color: "var(--d-tx)" }}>{single ? single.toFixed(1) : "--"}<small style={{ fontSize: 14 }}> ms</small></b><span>one chip, batch 1</span></div>
        <div><b style={{ fontSize: 28, color: nRun && nOk === nRun ? "var(--d-ok)" : "var(--d-tx)" }}>{nRun ? `${nOk}/${nRun}` : "--"}</b><span>match ground run (max prob diff {nRun ? worst.toFixed(4) : "--"}, tolerance {TOL})</span></div>
      </div>
      <div className="deep-row" style={{ marginBottom: 16 }}>
        <button className="deep-pri" disabled={!s || busy || !!err} onClick={runAll}>{busy ? "Running..." : "Run all 48"}</button>
        <button disabled={!s || busy || !!err} onClick={() => runOne(sel)}>Run chip {sel + 1}</button>
        <span className="deep-dim deep-mono" style={{ fontSize: 12 }}>
          {loadMs ? `model ready in ${(loadMs / 1000).toFixed(1)} s, wasm threads ${threads}${threads === 1 && !crossOriginIsolated ? " (page is not cross-origin isolated)" : ""}` : err ? "" : "loading model..."}
        </span>
      </div>
      {s && chip && (
        <div className="deep-inf">
          <div className="deep-grid" role="group" aria-label="Sample chips">
            {s.chips.map((c, i) => {
              const o = outs[i];
              return (
                <button key={i} className="deep-cell" aria-pressed={sel === i} onClick={() => setSel(i)} aria-label={`Chip ${i + 1}, ${c.site} ${c.date}${o ? (o.match ? ", matches ground" : ", differs from ground") : ""}`}>
                  <ChipCanvas s={s} ci={i} />
                  {o && <i className={o.match ? "deep-ok" : "deep-bad"}>{o.match ? "ok" : "!"}</i>}
                </button>
              );
            })}
          </div>
          <div className="deep-detail" aria-live="polite">
            <div className="deep-row" style={{ alignItems: "flex-start", gap: 16 }}>
              <ChipCanvas s={s} ci={sel} />
              <dl className="deep-kv">
                <dt>site</dt><dd>{chip.site}</dd><dt>scene</dt><dd>{chip.aoi} {chip.date}</dd><dt>location</dt><dd>{chip.lat.toFixed(3)}, {chip.lon.toFixed(3)}</dd>
                <dt>cloud</dt><dd>{out ? `${(out.cloud * 100).toFixed(1)}%` : "--"} <span className="deep-dim">ground {(chip.ground.cloud * 100).toFixed(1)}%</span></dd>
                <dt>inference</dt><dd>{out ? `${out.ms.toFixed(2)} ms` : "--"}</dd>
                <dt>vs ground</dt><dd>{out ? <span className={out.match ? "deep-ok" : "deep-bad"}>{out.match ? "match" : "differs"}, max diff {out.maxDiff.toFixed(4)}, cloud diff {out.cloudDiff.toFixed(4)}</span> : "run to compare"}</dd>
              </dl>
            </div>
            <div className="deep-bars">
              {top(shown!).map(([i, v]) => (
                <div className="deep-bar" key={i}><span>{s.classes[i]}</span><div><i style={{ width: `${v * 100}%` }} /></div><b>{(v * 100).toFixed(1)}%</b></div>
              ))}
            </div>
            <span className="deep-dim" style={{ fontSize: 12 }}>{out ? "Top 3 from this browser's run." : "Top 3 from the recorded ground run."}</span>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- pass bookkeeping */
interface PassRow { pass: Window; wins: number[]; used: number; cap: number }
function buildPasses(passes: Window[], wins: Window[], tl: RunOut["timeline"] | null): PassRow[] {
  const by = new Map<number, number[]>();
  wins.forEach((w, k) => { const p = (w as any).parent ?? w.id; (by.get(p) ?? by.set(p, []).get(p)!).push(k); });
  return passes.map((pass) => {
    const w = by.get(pass.id) ?? [];
    return { pass, wins: w, used: tl ? sum(w.map((k) => tl.bytes[k] ?? 0)) : 0, cap: tl ? sum(w.map((k) => tl.cap[k] ?? 0)) : 0 };
  });
}

/* ---------------------------------------------------------------- 2. gantt */
function Gantt({ rows, data, selId, setSel, ready }: { rows: PassRow[]; data: Data; selId: number | null; setSel: (id: number) => void; ready: boolean }) {
  const [view, setView] = useState<number>(-1); // -1 all, else day
  const [hov, setHov] = useState<{ r: PassRow; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stations = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.pass.station))];
    return ids.map((id) => ({ id, name: data.stations.find((s) => s.id === id)?.name ?? id }));
  }, [rows, data.stations]);
  const caps = useMemo(() => {
    const m = new Map<string, { t: number; aoi: string; date: string }>();
    for (const t of data.tiles) m.set(`${t.aoi}${t.date}`, { t: t.t_cap_min, aoi: t.aoi, date: t.date });
    return [...m.values()];
  }, [data.tiles]);
  const tMin = Math.min(...rows.map((r) => r.pass.start_min)), tMax = Math.max(...rows.map((r) => r.pass.end_min));
  const days = Math.ceil(tMax / 1440);
  const [a, b] = view < 0 ? [Math.floor(tMin / 60) * 60, tMax] : [view * 1440, (view + 1) * 1440];
  const W = 1200, L = 110, R = 12, T = 34, RH = 34, H = T + stations.length * RH + 28, X = (t: number) => L + ((t - a) / (b - a)) * (W - L - R);
  const vis = rows.filter((r) => r.pass.end_min >= a && r.pass.start_min <= b);
  const step = (d: number) => { const i = vis.findIndex((r) => r.pass.id === selId); const n = vis[Math.max(0, Math.min(vis.length - 1, (i < 0 ? 0 : i + d)))]; if (n) setSel(n.pass.id); };
  const ticks: number[] = []; for (let t = Math.ceil(a / (view < 0 ? 1440 : 240)) * (view < 0 ? 1440 : 240); t <= b; t += view < 0 ? 1440 : 240) ticks.push(t);
  return (
    <section className="deep-sec" aria-labelledby="deep-g-h">
      <header><span className="deep-n">B2</span><h3 id="deep-g-h">Pass Gantt: every contact window, filled by what HERALD sends</h3></header>
      <p className="deep-lede">Each bar is one real pass over a ground station. The amber fill is bytes sent under the H2 plan divided by that pass's capacity. Diamonds are scene captures. Pick a pass with the mouse or the arrow keys.</p>
      <div className="deep-row" style={{ marginBottom: 10 }} role="group" aria-label="Time range">
        <button aria-pressed={view < 0} onClick={() => setView(-1)}>All {days} days</button>
        {Array.from({ length: days }, (_, d) => <button key={d} aria-pressed={view === d} onClick={() => setView(d)}>Day {d + 1}</button>)}
        {!ready && <span className="deep-dim deep-mono" style={{ fontSize: 12 }}>computing plan...</span>}
      </div>
      <div className="deep-gantt" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="application" aria-label="Pass timeline. Left and right arrows change the selected pass." tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } }}>
          {ticks.map((t) => <g key={t}><line x1={X(t)} x2={X(t)} y1={T - 6} y2={H - 22} stroke="var(--line)" /><text x={X(t) + 4} y={H - 8} fontSize="11" fill="var(--mut)">{view < 0 ? `day ${Math.round(t / 1440) + 1}` : hm(t % 1440)}</text></g>)}
          {stations.map((s, k) => <g key={s.id}><text x={L - 10} y={T + k * RH + RH / 2 + 4} fontSize="11" fill="var(--mut)" textAnchor="end">{s.name.replace(/ \(.*/, "")}</text><line x1={L} x2={W - R} y1={T + (k + 1) * RH} y2={T + (k + 1) * RH} stroke="var(--panel2)" /></g>)}
          {caps.filter((c) => c.t >= a && c.t <= b).map((c, k) => <g key={k}><path d={`M${X(c.t)} ${T - 20}l5 5-5 5-5-5z`} fill="var(--tx)"><title>{`capture ${c.aoi} ${c.date} at ${hm(c.t % 1440)} (day ${Math.floor(c.t / 1440) + 1})`}</title></path></g>)}
          {vis.map((r) => {
            const k = stations.findIndex((s) => s.id === r.pass.station), x0 = X(Math.max(a, r.pass.start_min)), w = Math.max(3, X(Math.min(b, r.pass.end_min)) - x0), y = T + k * RH + 6, h = RH - 12;
            const f = r.cap > 0 ? Math.min(1, r.used / r.cap) : 0, on = r.pass.id === selId;
            return (
              <g key={r.pass.id} onClick={() => setSel(r.pass.id)} onMouseMove={(e) => { const bb = box.current!.getBoundingClientRect(); setHov({ r, x: e.clientX - bb.left, y: e.clientY - bb.top }); }} onMouseLeave={() => setHov(null)}>
                <rect className="pass" x={x0} y={y} width={w} height={h} rx="2" fill="var(--panel2)" stroke={on ? "var(--acc)" : "var(--line2)"} strokeWidth={on ? 2 : 1} />
                <rect className="pass" x={x0} y={y + h * (1 - f)} width={w} height={h * f} rx="2" fill="var(--acc)" opacity={on ? 1 : 0.8} />
                <title>{`${r.pass.station} ${hm(r.pass.start_min % 1440)}, ${(r.pass.end_min - r.pass.start_min).toFixed(1)} min, ${(f * 100).toFixed(0)}% used`}</title>
              </g>
            );
          })}
        </svg>
        {hov && (
          <div className="deep-tip" style={{ left: Math.min(hov.x + 14, (box.current?.clientWidth ?? 600) - 250), top: hov.y + 14 }}>
            <b>{stations.find((s) => s.id === hov.r.pass.station)?.name}</b><br />
            day {Math.floor(hov.r.pass.start_min / 1440) + 1}, {hm(hov.r.pass.start_min % 1440)} to {hm(hov.r.pass.end_min % 1440)} ({(hov.r.pass.end_min - hov.r.pass.start_min).toFixed(1)} min)<br />
            max elevation {hov.r.pass.max_el?.toFixed(0) ?? "?"} deg<br />
            sent {fbytes(hov.r.used)} of {fbytes(hov.r.cap)} ({hov.r.cap ? ((hov.r.used / hov.r.cap) * 100).toFixed(0) : 0}%)
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- 3. what goes down */
const imgCache = new Map<string, Promise<HTMLImageElement>>();
const loadImg = (u: string) => { let p = imgCache.get(u); if (!p) { p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(u)); i.src = u; }); imgCache.set(u, p); } return p; };

function Thumb({ t, size = 40 }: { t: Tile; size?: number }) {
  const r = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let dead = false;
    loadImg(`/data/img/${t.aoi}_${t.date}.jpg`).then((im) => {
      if (dead) return; const g = r.current?.getContext("2d"); if (!g) return;
      const n = im.naturalWidth / 46, row = Math.floor(t.id / 46), col = t.id % 46;
      g.imageSmoothingEnabled = false; g.drawImage(im, col * n, row * n, n, n, 0, 0, size, size);
    }, () => {});
    return () => { dead = true; };
  }, [t, size]);
  return <canvas ref={r} width={size} height={size} aria-hidden />;
}

interface Item { t: Tile; L: number; bytes: number; value: number; reason: string | null }
function itemsFor(r: RunOut | undefined, policy: "H2" | "B1", row: PassRow | null, data: Data, V: number[], n = 12): Item[] {
  if (!r || !row) return [];
  const set = new Set(row.wins), h2 = policy === "H2", fr = data.params.level_fraction;
  const m = new Map<number, Item>();
  for (const [i, L, w] of r.sel) {
    if (!set.has(w)) continue;
    const t = data.tiles[i], B = levelBytes(t.full_bytes, data.params);
    const inc = B[L] - (L && h2 ? B[L - 1] : 0), dv = V[i] * (fr[L] - (L && h2 ? fr[L - 1] : 0));
    const e = m.get(i);
    if (e) { e.L = Math.max(e.L, L); e.bytes += inc; e.value += dv; }
    else { if (m.size >= n) continue; m.set(i, { t, L, bytes: inc, value: dv, reason: t.cloud > data.params.cloud_drop ? `cloudy ${(t.cloud * 100).toFixed(0)}%` : V[i] <= 0 ? "zero value" : null }); }
  }
  return [...m.values()];
}

function Down({ data, out, row }: { data: Data; out: ReturnType<typeof useSched>["out"]; row: PassRow | null }) {
  const V = useMemo(() => data.tiles.map((t) => tileValue(t, data.queries, data.params)), [data]);
  const cols = useMemo(() => [
    { id: "H2", name: "HERALD (H2)", items: itemsFor(out?.results.H2, "H2", row, data, V) },
    { id: "B1", name: "FIFO", items: itemsFor(out?.results.B1, "B1", row, data, V) },
  ], [out, row, data, V]);
  const st = row && data.stations.find((s) => s.id === row.pass.station)?.name;
  return (
    <section className="deep-sec" aria-labelledby="deep-d-h">
      <header><span className="deep-n">B3</span><h3 id="deep-d-h">What goes down in this pass</h3>{row && <span className="deep-chip acc">{st}, day {Math.floor(row.pass.start_min / 1440) + 1} {hm(row.pass.start_min % 1440)}</span>}</header>
      <p className="deep-lede">First 12 items each policy sends, in send order. FIFO sends in capture order, so cloud and empty ground take the seats. Dimmed rows are bytes that bought no value. Rupee values are assumptions from the value model.</p>
      {!row ? <p className="deep-dim">Select a pass above.</p> : (
        <div className="deep-cols">
          {cols.map((c) => (
            <div className="deep-col" key={c.id}>
              <h4><span>{c.name}</span><span className="deep-dim">{c.items.length ? `${c.items.filter((i) => i.reason).length} of ${c.items.length} wasted` : "nothing sent"}</span></h4>
              <ol className="deep-items">
                {c.items.map((it) => (
                  <li key={it.t.id + it.t.aoi + it.t.date} className={`deep-item ${it.reason ? "waste" : ""}`}>
                    <Thumb t={it.t} />
                    <div><div>{it.t.aoi} {it.t.date} #{it.t.id}</div><div className="m"><span className="deep-chip">{LEVELS[it.L]}</span><span>cloud {(it.t.cloud * 100).toFixed(0)}%</span>{it.reason && <span className="deep-chip bad">{it.reason}</span>}</div></div>
                    <div className="v"><div>{inr(it.value)}</div><div className="deep-dim">{fbytes(it.bytes)}</div></div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- 4. link budget */
function LinkCalc({ data }: { data: Data }) {
  const [alt, setAlt] = useState(786), [el, setEl] = useState(10), [mbps, setMbps] = useState(100), [eff, setEff] = useState(0.7), [rho, setRho] = useState(1);
  const o = useMemo(() => linkBudget({ altKm: alt, minElDeg: el, mbps, eff, rho }), [alt, el, mbps, eff, rho]);
  const sim = data.reports.sim?.physics;
  const meanFull = useMemo(() => sum(data.tiles.map((t) => t.full_bytes)) / Math.max(1, data.tiles.length), [data.tiles]);
  const pk = data.params.level_bytes[0];
  const ok = sim && within(o.maxPassMin, sim.max_pass_min, 0.02) && within(o.bytesPerPass / 1e9, sim.gb_per_max_pass, 0.02);
  const f = (label: string, v: number, set: (n: number) => void, step: number) => (<><label htmlFor={`deep-${label}`}>{label}</label><input id={`deep-${label}`} type="number" step={step} min={0} value={v} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) set(n); }} /></>);
  return (
    <section className="deep-sec" aria-labelledby="deep-l-h">
      <header><span className="deep-n">B4</span><h3 id="deep-l-h">Link budget calculator</h3></header>
      <p className="deep-lede">How much one overhead pass can carry, and what that buys in chips. Defaults are the mission assumptions; change them to test another orbit or radio.</p>
      <div className="deep-calc">
        <div className="deep-fields">{f("altitude km", alt, setAlt, 1)}{f("min elevation deg", el, setEl, 1)}{f("rate Mbps", mbps, setMbps, 10)}{f("efficiency", eff, setEff, 0.05)}{f("rho", rho, (n) => setRho(Math.max(1, n)), 1)}</div>
        <div>
          <div className="deep-out">
            <div><span>max pass duration</span><b>{o.maxPassMin.toFixed(2)} min</b></div>
            <div><span>bytes per max pass</span><b>{(o.bytesPerPass / 1e9).toFixed(2)} GB</b></div>
            <div><span>slant range at {el} deg</span><b>{o.slantKm.toFixed(0)} km</b></div>
            <div><span>orbit period</span><b>{o.periodMin.toFixed(2)} min</b></div>
            <div><span>full chips per pass{rho > 1 ? ` (rho ${rho})` : ""}</span><b>{fits(o.bytesEffective, meanFull).toLocaleString("en-IN")}</b></div>
            <div><span>packets per pass</span><b>{fits(o.bytesEffective, pk).toLocaleString("en-IN")}</b></div>
          </div>
          <p className="deep-dim" style={{ fontSize: 12, marginTop: 10 }}>Full chip = {fbytes(meanFull)} (mean of tile sizes), packet = {fbytes(pk)}, both read from the tile and value files.</p>
          <p style={{ marginTop: 8 }}>{sim ? <span className={`deep-chip ${ok ? "ok" : "bad"}`}>{ok ? "matches sim" : "differs from sim"}: sim max pass {sim.max_pass_min} min, {sim.gb_per_max_pass} GB (mean altitude {sim.mean_alt_km} km)</span> : <span className="deep-chip">sim report not loaded</span>}</p>
        </div>
      </div>
      <details className="deep-how"><summary>How it works</summary><pre>{`a = R + h               R = ${RE} km, h = altitude
lambda = acos(R/a * cos(el)) - el        Earth-central half angle at min elevation el
T = 2 pi sqrt(a^3 / mu)                  mu = ${MU} km^3/s^2
max pass = T * lambda / pi               overhead pass, circular orbit
slant = sqrt(R^2 + a^2 - 2 R a cos(lambda))
bytes = rate * efficiency * max pass / 8
fit = floor(bytes / rho / item bytes)    rho = demand over capacity`}</pre></details>
    </section>
  );
}

/* ---------------------------------------------------------------- root */
export default function TrackB({ data }: { data: Data }) {
  const [rho, setRho] = useState(5);
  const { out } = useSched(data.tiles, data.wins, data.params, data.queries, rho);
  const h2 = out?.results.H2 ?? null;
  const rows = useMemo(() => buildPasses(data.passes, data.wins, h2?.timeline ?? null), [data.passes, data.wins, h2]);
  const [selId, setSelId] = useState<number | null>(null);
  const row = useMemo(() => rows.find((r) => r.pass.id === selId) ?? rows.find((r) => r.used > 0) ?? null, [rows, selId]);
  return (
    <div className="deep" aria-label="Onboard AI and downlink">
      <Inference />
      <div className="deep-row" role="group" aria-label="Bandwidth scarcity">
        <span className="deep-dim" style={{ fontSize: 13 }}>Bandwidth scarcity rho</span>
        {[1, 2, 5].map((r) => <button key={r} aria-pressed={rho === r} onClick={() => setRho(r)}>{r}x</button>)}
        <span className="deep-dim" style={{ fontSize: 12 }}>capacity = all full chips / rho</span>
      </div>
      {rows.length > 0 ? <Gantt rows={rows} data={data} selId={row?.pass.id ?? null} setSel={setSelId} ready={!!h2} /> : <p className="deep-dim">No pass data.</p>}
      <Down data={data} out={out} row={row} />
      <LinkCalc data={data} />
    </div>
  );
}
