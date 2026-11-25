import { chipFlagsToPx, detectChange, solarProxy, validFromCloud, type Change } from "./change";
import { classify } from "./model";
import { rgba, tile } from "./lib";

const OPEN = ["AnnualCrop", "HerbaceousVegetation", "Pasture", "PermanentCrop"];
export interface PairRes {
  W: number; H: number; cols: number; rows: number; p0: Uint16Array; p1: Uint16Array; change: Change; classes: string[]; mix: number[];
  cloud0: number; cloud1: number; ms: number; chips: number; solar: { usableHa: number; totalHa: number; share: number };
}

/** before/after planar DN [5,W,H]: model on both dates, cloud head -> validity, change rules, solar open-land proxy */
export async function analysePair(p0: Uint16Array, p1: Uint16Array, W: number, H: number, progress: (s: string) => void): Promise<PairRes> {
  const a = tile(p0, W, H), b = tile(p1, W, H), n = a.cols * a.rows;
  if (!n) throw new Error(`${W}x${H} px is smaller than one 64x64 chip.`);
  progress("onboard model, before");
  const m0 = await classify(a.chips, n, (s) => progress(`before: ${s}`));
  const m1 = await classify(b.chips, n, (s) => progress(`after: ${s}`));
  progress("change rules");
  const valid = validFromCloud([m0.cloud, m1.cloud], a.cols, a.rows, W, H);
  for (let i = 0; i < valid.length; i++) if (!p0[3 * W * H + i] || !p1[3 * W * H + i]) valid[i] = 0; // nodata
  const change = detectChange(p0, p1, W, H, valid);
  const top = m1.probs.map((p) => p.indexOf(Math.max(...p)));
  const mix = m1.classes.map((_, k) => top.filter((t) => t === k).length);
  const skip = chipFlagsToPx(top.map((t) => (OPEN.includes(m1.classes[t]) ? 0 : 1)), a.cols, a.rows, W, H);
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  return { W, H, cols: a.cols, rows: a.rows, p0, p1, change, classes: m1.classes, mix, cloud0: mean(m0.cloud), cloud1: mean(m1.cloud), ms: (m0.ms + m1.ms) / (2 * n), chips: n, solar: solarProxy(p1, W * H, skip, valid) };
}

export function canvasOf(planar: Uint16Array, W: number, H: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  c.getContext("2d")!.putImageData(new ImageData(rgba(planar, W, H) as unknown as ImageData["data"], W, H), 0, 0);
  return c;
}
