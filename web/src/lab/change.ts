// TS port of python/herald/change.py rules (construction + clearing + mine split), pixel level, 10 m px = 0.01 ha.
import thr from "./thresholds.json";

export const PX_HA = 0.01;
export type Bands = Uint16Array; // planar [5,N] DN, refl = DN*1e-4 (B02,B03,B04,B08,B11)
export interface Idx { ndvi: Float32Array; ndbi: Float32Array; mndwi: Float32Array; bsi: Float32Array }

const nd = (a: number, b: number) => { const s = a + b; return Math.abs(s) > 1e-6 ? (a - b) / s : 0; };

export function indices(x: Bands, N: number): Idx {
  const o: Idx = { ndvi: new Float32Array(N), ndbi: new Float32Array(N), mndwi: new Float32Array(N), bsi: new Float32Array(N) };
  for (let p = 0; p < N; p++) {
    const b2 = x[p] * 1e-4, b3 = x[N + p] * 1e-4, b4 = x[2 * N + p] * 1e-4, b8 = x[3 * N + p] * 1e-4, b11 = x[4 * N + p] * 1e-4;
    o.ndvi[p] = nd(b8, b4); o.ndbi[p] = nd(b11, b8); o.mndwi[p] = nd(b3, b11); o.bsi[p] = nd(b11 + b4, b8 + b2);
  }
  return o;
}

/** 8-connected components; lab 0 = background */
export function label(m: Uint8Array, W: number, H: number) {
  const lab = new Int32Array(W * H), st: number[] = []; let n = 0;
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || lab[s]) continue;
    lab[s] = ++n; st.push(s);
    while (st.length) {
      const p = st.pop()!, x = p % W, y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (m[q] && !lab[q]) { lab[q] = n; st.push(q); }
      }
    }
  }
  return { lab, n };
}

export function removeSmall(m: Uint8Array, W: number, H: number, minPx: number): Uint8Array {
  if (minPx <= 1) return m;
  const { lab, n } = label(m, W, H), cnt = new Int32Array(n + 1);
  for (let p = 0; p < lab.length; p++) cnt[lab[p]]++;
  return m.map((_, p) => (lab[p] && cnt[lab[p]] >= minPx ? 1 : 0)) as Uint8Array;
}

/** binary dilation, cross structuring element (scipy default), `it` iterations */
export function dilate(m: Uint8Array, W: number, H: number, it: number): Uint8Array {
  let a = m;
  for (let k = 0; k < it; k++) {
    const b = new Uint8Array(a);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (a[p]) continue;
      if ((x > 0 && a[p - 1]) || (x < W - 1 && a[p + 1]) || (y > 0 && a[p - W]) || (y < H - 1 && a[p + W])) b[p] = 1;
    }
    a = b;
  }
  return a;
}

export interface Change {
  construction: Uint8Array; built: Uint8Array; cleared: Uint8Array; forest: Uint8Array; mine: Uint8Array;
  ha: { construction: number; built: number; cleared: number; forestLoss: number; mine: number; clearing: number };
  dndviForest: number; // mean dNDVI over t0 forest pixels (valid)
}

const sum = (m: Uint8Array) => { let s = 0; for (let i = 0; i < m.length; i++) s += m[i]; return s; };

/** x0,x1 planar DN [5,W*H]; valid 1 = usable pixel on both dates */
export function detectChange(x0: Bands, x1: Bands, W: number, H: number, valid: Uint8Array): Change {
  const N = W * H, i0 = indices(x0, N), i1 = indices(x1, N), c = thr.construction, k = thr.clearing;
  let m: Uint8Array = new Uint8Array(N), f: Uint8Array = new Uint8Array(N), wet = new Uint8Array(N), forest0 = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const dn = i1.ndvi[p] - i0.ndvi[p], dd = i1.ndbi[p] - i0.ndbi[p], db = i1.bsi[p] - i0.bsi[p];
    m[p] = dn < -c.a_dndvi && (dd > c.b_dndbi || db > c.c_dbsi) && i1.mndwi[p] < 0 && i0.mndwi[p] < 0 && i1.ndvi[p] < c.ndvi1_max && valid[p] ? 1 : 0;
    wet[p] = i0.mndwi[p] > 0 ? 1 : 0;
    forest0[p] = i0.ndvi[p] > k.forest_ndvi ? 1 : 0;
  }
  m = removeSmall(m, W, H, c.min_px);
  const wet0 = k.water_margin_px ? dilate(wet, W, H, k.water_margin_px) : wet;
  for (let p = 0; p < N; p++) f[p] = forest0[p] && i1.ndvi[p] - i0.ndvi[p] < -k.d_ndvi && !wet0[p] && valid[p] ? 1 : 0;
  f = removeSmall(f, W, H, k.min_px);
  const built = m.map((v, p) => (v && i1.ndbi[p] > 0 && i1.bsi[p] < c.bsi_bare ? 1 : 0)) as Uint8Array;
  const cleared = m.map((v, p) => (v && !built[p] ? 1 : 0)) as Uint8Array;
  // mine split: loss component touching a >=10 ha non-water bare patch at t0
  const bare = removeSmall(Uint8Array.from({ length: N }, (_, p) => (i0.ndvi[p] < k.mine_bare_ndvi && i0.mndwi[p] < 0 ? 1 : 0)), W, H, k.mine_min_px);
  const near = dilate(bare, W, H, k.mine_touch_px), { lab, n } = label(f, W, H), hit = new Uint8Array(n + 1);
  for (let p = 0; p < N; p++) if (near[p] && f[p]) hit[lab[p]] = 1;
  const mine = f.map((_, p) => (lab[p] && hit[lab[p]] ? 1 : 0)) as Uint8Array;
  const forest = f.map((v, p) => (v && !mine[p] ? 1 : 0)) as Uint8Array;
  let sd = 0, sn = 0;
  for (let p = 0; p < N; p++) if (forest0[p] && valid[p]) { sd += i1.ndvi[p] - i0.ndvi[p]; sn++; }
  return {
    construction: m, built, cleared, forest, mine,
    ha: { construction: sum(m) * PX_HA, built: sum(built) * PX_HA, cleared: sum(cleared) * PX_HA, forestLoss: sum(forest) * PX_HA, mine: sum(mine) * PX_HA, clearing: sum(f) * PX_HA },
    dndviForest: sn ? sd / sn : 0,
  };
}

/** chip-level cloud (model head) -> pixel validity; pixels outside whole chips stay valid */
export function validFromCloud(clouds: number[][], cols: number, rows: number, W: number, H: number, thrCloud = 0.4): Uint8Array {
  const v = new Uint8Array(W * H).fill(1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!clouds.some((cl) => cl[r * cols + c] > thrCloud)) continue;
    for (let y = 0; y < 64; y++) v.fill(0, (r * 64 + y) * W + c * 64, (r * 64 + y) * W + c * 64 + 64);
  }
  return v;
}

/** per-chip flag -> per-pixel (zero outside whole chips) */
export function chipFlagsToPx(flags: ArrayLike<number>, cols: number, rows: number, W: number, H: number): Uint8Array {
  const v = new Uint8Array(W * H);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (flags[r * cols + c]) for (let y = 0; y < 64; y++) v.fill(1, (r * 64 + y) * W + c * 64, (r * 64 + y) * W + c * 64 + 64);
  return v;
}

/** open-land share for solar (proxy, slope unknown): water/forest/skip = 0, bare/grass 1, shrub-crop 0.5 (config weights: bare 1, grass 1, shrub .7, crop .4) */
export function solarProxy(x: Bands, N: number, skip: Uint8Array, valid: Uint8Array) {
  const i = indices(x, N); let usable = 0, v = 0;
  for (let p = 0; p < N; p++) {
    if (!valid[p]) continue; v++;
    if (skip[p] || i.mndwi[p] > 0 || i.ndvi[p] > 0.6) continue;
    usable += i.ndvi[p] < 0.35 ? 1 : 0.5;
  }
  return { usableHa: usable * PX_HA, totalHa: v * PX_HA, share: v ? usable / v : 0 };
}
