// Onboard model in the browser: onnxruntime-web, wasm EP, local files only.
import type * as Ort from "onnxruntime-web";

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

let sess: Promise<{ s: Ort.InferenceSession; ort: typeof Ort; threads: number; loadMs: number }> | null = null;
export function getSession() {
  return (sess ??= (async () => {
    const t0 = performance.now();
    const ort = await import("onnxruntime-web/wasm");
    const threads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
    ort.env.wasm.numThreads = threads;
    ort.env.wasm.wasmPaths = "/model/ort/";
    const s = await ort.InferenceSession.create("/model/herald_int8.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    return { s, ort, threads: ort.env.wasm.numThreads ?? threads, loadMs: performance.now() - t0 };
  })().catch((e) => { sess = null; throw e; }));
}

/** Run chips idx in one batch; returns per-chip outputs + total ms (per-chip ms = total/n). */
export async function infer(s: Sample, idx: number[]): Promise<{ outs: ChipOut[]; totalMs: number }> {
  const { s: session, ort } = await getSession();
  const x = inputFor(s, idx);
  const t0 = performance.now();
  const r = await session.run({ x: new ort.Tensor("float32", x, [idx.length, s.shape[1], s.shape[2], s.shape[3]]) });
  const totalMs = performance.now() - t0;
  const K = s.classes.length, lg = r.logits.data as Float32Array, cl = r.cloud.data as Float32Array;
  const outs = idx.map((ci, k) => {
    const probs = softmaxT(lg, k * K, K, s.temperature), cloud = cl[k];
    return { probs, cloud, ms: totalMs / idx.length, ...compare(probs, cloud, s.chips[ci]) };
  });
  return { outs, totalMs };
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
