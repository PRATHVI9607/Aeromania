// Onboard model in the browser: onnxruntime-web, wasm EP, local files only.

export interface Chip { site: string; aoi: string; date: string; tile: number; lat: number; lon: number; ground: { probs: number[]; cloud: number } }
export interface Sample {
  shape: number[]; scale: number; bands: string[]; mean: number[]; std: number[]; temperature: number; classes: string[]; chips: Chip[]; raw: Uint16Array;
}
export interface ChipOut { probs: number[]; cloud: number; ms: number; maxDiff: number; cloudDiff: number; match: boolean }

export async function loadSample(): Promise<Sample> {
  const [jr, br] = await Promise.all([fetch("/data/onboard_sample.json"), fetch("/data/onboard_sample.bin")]);
  if (!jr.ok || !br.ok) throw new Error("onboard_sample.json/.bin missing in /data");
  const j = await jr.json(), buf = await br.arrayBuffer();
  const raw = new Uint16Array(buf);
  const n = j.shape.reduce((a: number, b: number) => a * b, 1);
  if (raw.length !== n) throw new Error(`onboard_sample.bin size ${raw.length} != shape ${j.shape.join("x")}`);
  return { ...j, raw };
}

const chipLen = (s: Sample) => s.shape[1] * s.shape[2] * s.shape[3];

/** normalized float32 [n,5,64,64] for chips idx */
export function inputFor(s: Sample, idx: number[]): Float32Array {
  const [, C, H, W] = s.shape, L = chipLen(s), P = H * W;
  const x = new Float32Array(idx.length * L);
  idx.forEach((ci, k) => {
    for (let c = 0; c < C; c++) {
      const m = s.mean[c], sd = s.std[c], o = k * L + c * P, r = ci * L + c * P;
      for (let p = 0; p < P; p++) x[o + p] = (s.raw[r + p] * s.scale - m) / sd;
    }
  });
  return x;
}

export function softmaxT(logits: ArrayLike<number>, off: number, n: number, T: number): number[] {
  let mx = -Infinity; for (let i = 0; i < n; i++) mx = Math.max(mx, logits[off + i] / T);
  const e: number[] = []; let z = 0;
  for (let i = 0; i < n; i++) { const v = Math.exp(logits[off + i] / T - mx); e.push(v); z += v; }
  return e.map((v) => v / z);
}

export const TOL = 0.02;
export function compare(probs: number[], cloud: number, c: Chip) {
  const maxDiff = Math.max(...probs.map((p, i) => Math.abs(p - c.ground.probs[i])));
  const cloudDiff = Math.abs(cloud - c.ground.cloud);
  return { maxDiff, cloudDiff, match: maxDiff <= TOL && cloudDiff <= TOL };
}

interface Ready { threads: number; loadMs: number }
let wk: Worker | null = null, ready: Promise<Ready> | null = null, seq = 0;
const pending = new Map<number, { res: (m: any) => void; rej: (e: Error) => void }>();

export function getSession(): Promise<Ready> {
  return (ready ??= new Promise<Ready>((res, rej) => {
    wk = new Worker(new URL("./ortWorker.ts", import.meta.url), { type: "module" });
    wk.onerror = (e) => rej(new Error(e.message || "worker failed to start"));
    wk.onmessage = (e) => {
      const m = e.data;
      if (m.type === "ready") res({ threads: m.threads, loadMs: m.loadMs });
      else if (m.type === "error" && m.id === undefined) rej(new Error(m.message));
      else if (m.id !== undefined) { const p = pending.get(m.id); pending.delete(m.id); m.type === "error" ? p?.rej(new Error(m.message)) : p?.res(m); }
    };
    wk.postMessage({ type: "init" });
  }).catch((e) => { ready = null; wk?.terminate(); throw e; }));
}

/** Run chips idx in one batch; returns per-chip outputs + total ms (per-chip ms = total/n). */
export async function infer(s: Sample, idx: number[]): Promise<{ outs: ChipOut[]; totalMs: number }> {
  await getSession();
  const x = inputFor(s, idx), id = ++seq;
  const m = await new Promise<any>((res, rej) => { pending.set(id, { res, rej }); wk!.postMessage({ type: "run", id, x, n: idx.length, c: s.shape[1], h: s.shape[2], w: s.shape[3] }, [x.buffer]); });
  const K = s.classes.length;
  const outs = idx.map((ci, k) => {
    const probs = softmaxT(m.logits, k * K, K, s.temperature), cloud = m.cloud[k] as number;
    return { probs, cloud, ms: m.ms / idx.length, ...compare(probs, cloud, s.chips[ci]) };
  });
  return { outs, totalMs: m.ms as number };
}

/** 2-98 percentile stretched RGB (B04,B03,B02) of chip ci into an ImageData. */
export function rgbChip(s: Sample, ci: number): ImageData {
  const [, , H, W] = s.shape, P = H * W, L = chipLen(s), bi = (b: string) => s.bands.indexOf(b);
  const ch = [bi("B04"), bi("B03"), bi("B02")];
  const vals: number[] = [];
  for (const c of ch) for (let p = 0; p < P; p += 3) vals.push(s.raw[ci * L + c * P + p]);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.floor(vals.length * 0.98)], d = Math.max(1, hi - lo);
  const img = new ImageData(W, H);
  for (let p = 0; p < P; p++) {
    for (let k = 0; k < 3; k++) img.data[p * 4 + k] = Math.max(0, Math.min(255, ((s.raw[ci * L + ch[k] * P + p] - lo) / d) * 255));
    img.data[p * 4 + 3] = 255;
  }
  return img;
}
