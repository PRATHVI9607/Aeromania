import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewProps } from "./props";
import { useJson } from "../useJson";

/** Lake watch: replays the real water-detection processing on Sentinel-2 bands, date by date (data: /data/lakes.json from `herald crops`). */
type D = { date: string; water_ha: number; valid: number; mndwi: string; water: string; rgb?: string };
type Lake = { id: string; name: string | null; acres: number | null; dates: Record<string, D>; report: Record<string, number | null> };
const ORDER = ["t0", "c1", "t1", "c2"];
const STEPS = ["Sentinel-2 bands", "Water index (MNDWI)", "Threshold > 0 = water", "Cloud mask (SCL)", "Water area"];
const u = (p?: string) => (p ? `/data/${p.replace(/^data\//, "")}` : "");
const SZ = 432; // 192 px window at 2.25x, pixelated: true 10 m pixels

export default function LakeWatch(_: ViewProps) {
  const j = useJson<{ lakes: Lake[] }>("lakes.json");
  const lakes = useMemo(() => (j?.lakes ?? []).filter((l) => Object.keys(l.dates).length).slice(0, 8), [j]);
  const [li, setLi] = useState(0), [di, setDi] = useState(0), [step, setStep] = useState(4), [run, setRun] = useState(false);
  const timer = useRef<number | null>(null);
  const lake = lakes[li];
  const dates = useMemo(() => (lake ? ORDER.filter((d) => lake.dates[d]) : []), [lake]);
  const cur = lake?.dates[dates[di]];
  const done = useMemo(() => dates.slice(0, step === 4 ? di + 1 : di), [dates, di, step]); // dates whose area is already measured
  useEffect(() => { setDi(0); setStep(4); setRun(false); }, [li]);
  useEffect(() => {
    if (!run) return;
    timer.current = window.setTimeout(() => {
      if (step < 4) setStep(step + 1);
      else if (di < dates.length - 1) { setDi(di + 1); setStep(0); }
      else setRun(false);
    }, step === 4 ? 1100 : 750);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [run, step, di, dates.length]);
  if (j === undefined) return <section className="panel"><p className="muted">loading lakes</p></section>;
  if (!lake) return <section className="panel"><h3>Lake watch <small>no data</small></h3><p className="muted">web/public/data/lakes.json missing: run python -m herald crops.</p></section>;
  const first = lake.dates[dates[0]], last = [...dates].reverse().map((d) => lake.dates[d]).find((x) => x.valid >= 0.9) ?? lake.dates[dates[dates.length - 1]];
  const loss = first.water_ha - last.water_ha, pct = first.water_ha ? (loss / first.water_ha) * 100 : 0;
  const max = Math.max(...dates.map((d) => lake.dates[d].water_ha), 1);
  const start = () => { setDi(0); setStep(0); setRun(true); };
  const R = lake.report;
  return (
    <div className="lw">
      <header className="lw-head">
        <h2>Lake watch</h2>
        <div className="lw-lakes" role="tablist" aria-label="Lakes">
          {lakes.map((l, k) => <button key={l.id} role="tab" aria-selected={k === li} className={k === li ? "on" : ""} onClick={() => setLi(k)}>{l.name?.startsWith("unnamed") ? `Lake ${k + 1}` : l.name}</button>)}
        </div>
        <button className="lw-run" onClick={start} disabled={run}>{run ? "Processing..." : "Run processing"}</button>
      </header>

      <div className="lw-grid">
        <section className="lw-view panel">
          <div className="lw-steps">
            {STEPS.map((s, k) => <span key={s} className={k < step || (k === step && !run) ? "ok" : k === step ? "now" : ""}><i>{k + 1}</i>{s}</span>)}
          </div>
          <div className="lw-img" style={{ width: SZ, height: SZ }}>
            {cur && <>
              <img src={u(cur.rgb)} alt={`${lake.name} ${cur.date} true colour`} width={SZ} height={SZ} />
              <img src={u(cur.mndwi)} alt="" width={SZ} height={SZ} style={{ opacity: step === 1 ? 1 : 0 }} />
              <img src={u(cur.water)} alt="" width={SZ} height={SZ} style={{ opacity: step >= 2 ? 1 : 0 }} />
              <span className="lw-date num">{cur.date}{cur.valid < 0.9 ? ` · ${Math.round((1 - cur.valid) * 100)}% cloud` : ""}</span>
              {step >= 4 && <span className="lw-ha num">{cur.water_ha.toFixed(1)} ha water</span>}
              <span className="lw-scale">500 m</span>
            </>}
          </div>
          <div className="lw-film">
            {dates.map((d, k) => <button key={d} className={k === di ? "on" : ""} onClick={() => { setRun(false); setDi(k); setStep(4); }}>
              <img src={u(lake.dates[d].water)} alt="" width={64} height={64} style={{ backgroundImage: `url(${u(lake.dates[d].rgb)})` }} /><span className="num">{lake.dates[d].date}</span></button>)}
          </div>
        </section>

        <section className="lw-side panel">
          <div className="lw-kpis">
            <div><span className="dim">water {first.date?.slice(0, 7)}</span><b className="num">{first.water_ha.toFixed(1)} ha</b></div>
            <div><span className="dim">water {last.date?.slice(0, 7)}</span><b className="num">{last.water_ha.toFixed(1)} ha</b></div>
            <div><span className="dim">change</span><b className={`num ${loss > 0 ? "bad" : "ok"}`}>{loss > 0 ? "−" : "+"}{Math.abs(pct).toFixed(0)}%</b></div>
          </div>
          <svg className="lw-chart" viewBox="0 0 320 170" role="img" aria-label="Water area per date">
            {dates.map((d, k) => {
              const x = 30 + k * (270 / Math.max(1, dates.length - 1)), v = lake.dates[d], y = 140 - (v.water_ha / max) * 115, on = done.includes(d);
              return <g key={d}>
                <line x1={x} y1={140} x2={x} y2={on ? y : 140} stroke="#22D3EE" strokeWidth={10} strokeOpacity={v.valid < 0.9 ? 0.35 : 0.85} style={{ transition: "all .5s" }} />
                {on && <text x={x} y={y - 6} textAnchor="middle" className="num" fontSize="10" fill="#E6EDF3">{v.water_ha.toFixed(0)}</text>}
                <text x={x} y={156} textAnchor="middle" fontSize="9" fill="#8A97A8">{v.date?.slice(0, 7)}</text>
              </g>;
            })}
            <text x={4} y={12} fontSize="9" fill="#8A97A8">ha of water in the 1.9 km window</text>
          </svg>
          {(R.lost_to_veg_ha != null) && <div className="lw-lost">
            <span className="dim">lost water became (Feb 2023 → Feb 2025, lake outline)</span>
            {([["vegetation", R.lost_to_veg_ha, "#34D399"], ["bare soil", R.lost_to_bare_ha, "#F5A524"], ["built-up", R.lost_to_built_ha, "#F87171"]] as [string, number | null, string][]).map(([k, v, c]) =>
              <div key={k} className="lw-bar"><span>{k}</span><i style={{ width: `${Math.min(100, ((v ?? 0) / Math.max(1, (R.lost_to_veg_ha ?? 0) + (R.lost_to_bare_ha ?? 0) + (R.lost_to_built_ha ?? 0))) * 100)}%`, background: c }} /><b className="num">{(v ?? 0).toFixed(1)} ha</b></div>)}
          </div>}
          <div className="lw-verdict">{(R.lost_to_built_ha ?? 0) >= 0.2 ? "Possible filling: verify on ground" : "Drying / seasonal: no built-up in the lake bed"}</div>
        </section>
      </div>
    </div>
  );
}
