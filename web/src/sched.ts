// Exact port of python/herald/sched.py (same tie-breaks, same float order of operations).
import type { Params, PolicyId, Query, RunOut, SchedOut, Tile, Window } from "./types";
import { levelBytes, tileValue } from "./value";

export const POLICIES: PolicyId[] = ["B1", "B2", "B3", "H1", "H2"];
type Entry = [number, number, number]; // (key, tile index, level): python tuple ordering

const lt = (a: Entry, b: Entry) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));

class Heap {
  a: Entry[] = [];
  get length() { return this.a.length; }
  push(e: Entry) {
    const a = this.a; let i = a.length; a.push(e);
    while (i > 0) { const p = (i - 1) >> 1; if (!lt(e, a[p])) break; a[i] = a[p]; i = p; }
    a[i] = e;
  }
  pop(): Entry {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      let i = 0; const n = a.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && lt(a[c + 1], a[c])) c++;
        if (!lt(a[c], last)) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

export interface Prep { V: number[]; B: number[][] }
export function prepare(tiles: Tile[], queries: Query[], p: Params): Prep {
  return { V: tiles.map((t) => tileValue(t, queries, p)), B: tiles.map((t) => levelBytes(t.full_bytes, p)) };
}

export function capacities(windows: Window[], p: Params, rho: number, B: number[][]): [number[], number] {
  let s = 0; for (const b of B) s += b[2];
  const total = s / rho;
  let dur = 0; for (const w of windows) dur += w.end_min - w.start_min;
  return [windows.map((w) => (total * (w.end_min - w.start_min)) / dur), total];
}

export function upperBound(V: number[], B: number[][], p: Params, totalCap: number): number {
  const fr = p.level_fraction;
  const items: [number, number, number, number, number][] = [];
  V.forEach((v, i) => {
    if (v <= 0) return;
    let pb = 0, pf = 0.0;
    for (let L = 0; L < 3; L++) {
      const db = B[i][L] - pb, df = fr[L] - pf;
      items.push([-((v * df) / db), i, L, v * df, db]);
      pb = B[i][L]; pf = fr[L];
    }
  });
  items.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  let left = totalCap, val = 0.0;
  for (const it of items) {
    if (left <= 0) break;
    const x = Math.min(1.0, left / it[4]);
    val += it[3] * x;
    left -= it[4] * x;
  }
  return val;
}

export function run(policy: PolicyId, tiles: Tile[], windows: Window[], p: Params, queries: Query[], rho: number, prep?: Prep, ubIn?: number): RunOut {
  const { V, B } = prep ?? prepare(tiles, queries, p);
  const fr = p.level_fraction, hl = p.half_life_h;
  const [caps, total] = capacities(windows, p, rho, B);
  const n = tiles.length;
  const h2 = policy === "H2";
  const steps = h2 ? [0, 1, 2] : [2];
  const pull = p.pull_threshold;
  let minInc = 0;
  if (n) { minInc = Infinity; for (const b of B) minInc = Math.min(minInc, h2 ? b[0] : b[2]); }

  const entry = (i: number, L: number): Entry | null => {
    const v = V[i], t = tiles[i];
    let k: number;
    if (policy === "B1") k = t.t_cap_min;
    else if (policy === "B2") { if (t.cloud > p.cloud_drop) return null; k = t.t_cap_min; }
    else if (v <= 0 || (L === 2 && h2 && v < pull)) return null;
    else if (policy === "B3") k = -v;
    else {
      const useP = L && h2;
      const pb = useP ? B[i][L - 1] : 0, pf = useP ? fr[L - 1] : 0.0;
      k = -((v * (fr[L] - pf)) / (B[i][L] - pb));
    }
    return [k, i, L];
  };

  const order = tiles.map((_, i) => i).sort((a, b) => tiles[a].t_cap_min - tiles[b].t_cap_min || a - b);
  let ptr = 0; const heap = new Heap(); const sel: [number, number, number][] = [];
  let tv = 0; for (const v of V) tv += v;
  const target = 0.9 * tv;
  let cumRaw = 0, cumVal = 0, cumBytes = 0, cloudBytes = 0;
  let minutes = 0, firstMin: number | null = null, ttfi: number | null = null;
  const tl = { bytes: [] as number[], value: [] as number[], cum_value: [] as number[], cloud_bytes: [] as number[], cap: [] as number[] };
  const level = new Array<number>(n).fill(-1);
  windows.forEach((win, w) => {
    while (ptr < n && tiles[order[ptr]].t_cap_min <= win.start_min) {
      const e = entry(order[ptr], steps[0]);
      if (e) heap.push(e);
      ptr++;
    }
    let left = caps[w], wb = 0.0, wv = 0.0, wc = 0.0;
    const skipped: Entry[] = [];
    const dur = win.end_min - win.start_min;
    while (heap.length && left >= minInc) {
      const e = heap.pop();
      const i = e[1], L = e[2];
      const inc = B[i][L] - (L && h2 ? B[i][L - 1] : 0);
      if (inc > left) { skipped.push(e); continue; }
      left -= inc;
      const df = fr[L] - (L && h2 ? fr[L - 1] : 0.0);
      const dv = V[i] * df;
      const real = dv * Math.pow(0.5, (win.end_min - tiles[i].t_cap_min) / 60 / hl);
      wb += inc; wv += real; cumRaw += dv;
      if (tiles[i].cloud > 0.5) wc += inc;
      if (V[i] > 0 && ttfi === null) ttfi = win.end_min - tiles[i].t_cap_min;
      if (firstMin === null && target > 0 && cumRaw >= target) firstMin = minutes + (dur * (caps[w] - left)) / caps[w];
      sel.push([i, L, w]);
      level[i] = L;
      if (h2 && L < 2) { const nx = entry(i, L + 1); if (nx) heap.push(nx); }
    }
    for (const e of skipped) heap.push(e);
    minutes += dur;
    cumVal += wv; cumBytes += wb; cloudBytes += wc;
    tl.bytes.push(wb); tl.value.push(wv); tl.cum_value.push(cumVal); tl.cloud_bytes.push(wc); tl.cap.push(caps[w]);
  });
  const ub = ubIn ?? upperBound(V, B, p, total);
  return { sel, level, timeline: tl, metrics: {
    value: cumVal, ub, pct_ub: ub ? cumVal / ub : null, minutes_to_90: firstMin, ttfi_min: ttfi, bytes_sent: cumBytes,
    cloud_bytes: cloudBytes, capacity_bytes: total, total_value: tv } };
}

/** All five policies, UB computed once. `ms` = pure compute time. */
export function runAll(tiles: Tile[], windows: Window[], p: Params, queries: Query[], rho: number): SchedOut {
  const t0 = performance.now();
  const prep = prepare(tiles, queries, p);
  const ub = upperBound(prep.V, prep.B, p, capacities(windows, p, rho, prep.B)[1]);
  const results = {} as Record<PolicyId, RunOut>;
  for (const pol of POLICIES) results[pol] = run(pol, tiles, windows, p, queries, rho, prep, ub);
  return { results, rho, ms: performance.now() - t0 };
}
