import { useMemo } from "react";
import type { ViewProps } from "./props";
import { prepare } from "../sched";
import { bytes, hm, ha as fha, inr } from "../fmt";

import { explain } from "../explain";

const LV = ["256 B packet", "thumbnail", "full chip"];
const dur = (m: number) => (m < 120 ? `${m.toFixed(1)} min` : `${(m / 60).toFixed(1)} h`);

/** Worked examples for Track B, all derived from the current scheduler output. */
export function TileWalk({ data, out, queries, rho }: ViewProps) {
  const prep = useMemo(() => prepare(data.tiles, queries, data.params), [data.tiles, queries, data.params]);
  const ex = useMemo(() => {
    if (!out) return null;
    const H = out.results.H2.sel, F = out.results.B1.sel;
    const best = new Map<number, number>(); for (const [ti] of H) best.set(ti, prep.V[ti]);
    const first = [...best].filter(([ti]) => data.tiles[ti].aoi === "blr" && data.tiles[ti].cloud < 0.3).sort((a, b) => b[1] - a[1])[0];
    if (!first) return null;
    const ti = first[0], t = data.tiles[ti];
    const hs = H.filter(([i]) => i === ti).sort((a, b) => a[1] - b[1]), fs = F.filter(([i]) => i === ti);
    const q = queries.filter((q) => q.aois.includes(t.aoi) && t.sev >= q.min_sev);
    const w0 = data.wins[Math.min(...H.map((x) => x[2]))];
    const win = (L: number, set: typeof H) => { const e = set.find((x) => x[0] === ti && x[1] === L); return e ? data.wins[e[2]] : null; };
    const firstW = H[0]?.[2], inWin = (set: typeof H) => set.filter((x) => x[2] === firstW).slice(0, 10);
    return { ti, t, q, v: prep.V[ti], hs, fs, win, w0, h10: inWin(H), f10: inWin(F), firstW };
  }, [out, prep, data, queries]);
  if (!out || !ex) return <p className="muted">Computing the plan.</p>;
  const { t, v, q, win } = ex;
  const stepRows = [
    ["Captured", `T+${hm(t.t_cap_min)}`, `Tile ${t.id} over ${t.aoi}, ${fha(t.ha, 1)} changed, cloud ${(t.cloud * 100).toFixed(0)}%.`],
    ["Onboard AI", "< 1 ms", `int8 model labels it ${t.cls} (confidence ${(t.conf * 100).toFixed(0)}%), measures cloud and change severity ${t.sev.toFixed(2)}. No raw pixels leave the satellite yet.`],
    ["Value", inr(v), `${q.length ? q.map((x) => x.name ?? x.id).join("; ") : "no query"} match: ha x priority x rupees per ha (assumption), reduced by cloud.`],
    ...[0, 1, 2].map((L) => { const w = win(L, out.results.H2.sel); return [`HERALD: ${LV[L]}`, w ? `T+${hm(w.start_min)}` : "not sent", w ? `${dur(w.start_min - t.t_cap_min)} after capture, ${w.station} pass, ${bytes(prep.B[ex.ti][L])} cumulative.` : "Does not fit in the passes at this rho, or its marginal value is too low."]; }),
    ["FIFO, same tile", ex.fs.length ? `T+${hm(data.wins[ex.fs[0][2]].start_min)}` : "never", ex.fs.length ? `Sent in capture order, ${dur(data.wins[ex.fs[0][2]].start_min - t.t_cap_min)} after capture.` : `FIFO sends in capture order and the link is full before this tile (rho ${rho}).`],
  ];
  const row = (e: [number, number, number], k: number) => { const x = data.tiles[e[0]]; return <tr key={k}><td className="mono">{k + 1}</td><td className="mono">{x.id}</td><td>{x.aoi} <span className="dim">{x.kind}</span></td><td className="mono r">{(x.cloud * 100).toFixed(0)}%</td><td className="mono r">{fha(x.ha, 1)}</td><td className="mono r">{bytes(prep.B[e[0]][e[1]])}</td><td className="mono r">{inr(prep.V[e[0]] * (data.params.level_fraction[e[1]] - (e[1] ? data.params.level_fraction[e[1] - 1] : 0)))}</td></tr>; };
  const tbl = (rows: [number, number, number][]) => <div className="tblwrap"><table className="tbl"><thead><tr><th>#</th><th>Tile</th><th>AOI</th><th className="r">Cloud</th><th className="r">Changed</th><th className="r">Bytes</th><th className="r">Value</th></tr></thead><tbody>{rows.map(row)}</tbody></table></div>;
  return (
    <div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="panel span2"><h3>Follow one tile <small>highest-value Bengaluru tile in the plan; values are assumptions</small></h3>
          <ol className="walk">{stepRows.map(([a, b, c]) => <li key={a}><b>{a}</b><span className="mono acc">{b}</span><span>{c}</span></li>)}</ol></section>
        <section className="panel"><h3>HERALD sends first <small>first 10 items of the first pass</small></h3>{tbl(ex.h10 as any)}</section>
        <section className="panel"><h3>FIFO sends first <small>same pass, capture order</small></h3>{tbl(ex.f10 as any)}<p className="muted small">FIFO spends bytes on whatever was captured first, including cloudy and unchanged tiles.</p></section>
      </div>
    </div>
  );
}
