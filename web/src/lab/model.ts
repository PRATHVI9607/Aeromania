import { infer, type Sample } from "../deep/onnx";

let meta: Promise<any> | null = null;
export const modelMeta = () => (meta ??= fetch("/data/onboard_sample.json").then((r) => r.json()));
const BATCH = 16;

/** Run the onboard int8 model over chips [n,5,64,64] uint16 DN; returns probs, cloud, total ms */
export async function classify(chips: Uint16Array, n: number, progress: (s: string) => void = () => {}) {
  const j = await modelMeta();
  const dummy = { ground: { probs: new Array(j.classes.length).fill(0), cloud: 0 } };
  const s = { shape: [n, 5, 64, 64], scale: j.scale, bands: j.bands, mean: j.mean, std: j.std, temperature: j.temperature, classes: j.classes, chips: new Array(n).fill(dummy), raw: chips } as unknown as Sample;
  const probs: number[][] = [], cloud: number[] = []; let ms = 0;
  for (let i = 0; i < n; i += BATCH) {
    progress(`onboard model ${i}/${n}`);
    const { outs, totalMs } = await infer(s, Array.from({ length: Math.min(BATCH, n - i) }, (_, k) => i + k));
    ms += totalMs; outs.forEach((o) => { probs.push(o.probs); cloud.push(o.cloud); });
  }
  return { probs, cloud, ms, classes: j.classes as string[] };
}
