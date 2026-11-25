// Pure helpers for the Lab: band selection, tiling, preview, value + downlink ordering.
export const C = 64, P = C * C, CHIP_HA = 40.96;
export const RELEVANT = ["Industrial", "Residential", "Highway"];

/** indices of B02,B03,B04,B08,B11 in an n-band raster, or an error message */
export function selectBands(n: number): { idx: number[] } | { error: string } {
  if (n === 5) return { idx: [0, 1, 2, 3, 4] };
  if (n === 13) return { idx: [1, 2, 3, 7, 11] }; // L1C: B01..B8A,B09,B10,B11,B12
  if (n === 12) return { idx: [1, 2, 3, 7, 10] }; // L2A: no B10
  if (n === 3) return { error: "RGB only (3 bands): the onboard model needs NIR (B08) and SWIR (B11)." };
  return { error: `${n} bands: expected 5 (B02,B03,B04,B08,B11) or a 12/13-band Sentinel-2 stack.` };
}

/** planar [5,H,W] -> chips [n,5,64,64] in row-major tile order; edges dropped */
export function tile(planar: Uint16Array, W: number, H: number) {
  const cols = Math.floor(W / C), rows = Math.floor(H / C), L = 5 * P;
  const chips = new Uint16Array(cols * rows * L);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const o = (r * cols + c) * L;
    for (let b = 0; b < 5; b++) for (let y = 0; y < C; y++) {
      const s = b * W * H + (r * C + y) * W + c * C;
      chips.set(planar.subarray(s, s + C), o + b * P + y * C);
    }
  }
  return { chips, cols, rows };
}

/** RGBA preview (B04,B03,B02) with a shared 2-98% stretch */
export function rgba(planar: Uint16Array, W: number, H: number): Uint8ClampedArray {
  const N = W * H, ch = [2, 1, 0], out = new Uint8ClampedArray(N * 4);
  const sample: number[] = [];
  for (const c of ch) for (let p = 0; p < N; p += 7) sample.push(planar[c * N + p]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.02)], d = Math.max(1, sample[Math.floor(sample.length * 0.98)] - lo);
  for (let p = 0; p < N; p++) {
    for (let k = 0; k < 3; k++) out[p * 4 + k] = ((planar[ch[k] * N + p] - lo) / d) * 255;
    out[p * 4 + 3] = 255;
  }
  return out;
}

export const pRel = (probs: number[], classes: string[]) => RELEVANT.reduce((s, n) => s + (probs[classes.indexOf(n)] ?? 0), 0);
export const chipValue = (cloud: number, rel: number, rupeesPerHa: number) => (1 - cloud) * rel * rupeesPerHa * CHIP_HA;

export interface Item { value: number; bytes: number }
/** HERALD = greedy by value per byte; FIFO = row order, stop at first chip that does not fit. capacity in bytes. */
export function plan(items: Item[], capacity: number) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const order = items.map((_, i) => i).sort((a, b) => items[b].value / items[b].bytes - items[a].value / items[a].bytes);
  const herald: number[] = [], fifo: number[] = [];
  let used = 0;
  for (const i of order) if (used + items[i].bytes <= capacity) { used += items[i].bytes; herald.push(i); }
  used = 0;
  for (let i = 0; i < items.length && used + items[i].bytes <= capacity; i++) { used += items[i].bytes; fifo.push(i); }
  const sum = (s: number[]) => s.reduce((a, i) => a + items[i].value, 0);
  return { herald, fifo, heraldPct: (100 * sum(herald)) / total, fifoPct: (100 * sum(fifo)) / total, total };
}

export async function deflateLen(u8: Uint8Array): Promise<number> {
  const cs = new Blob([u8 as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return (await new Response(cs).arrayBuffer()).byteLength;
}
