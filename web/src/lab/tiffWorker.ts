// GeoTIFF -> planar uint16 [5,H,W] (B02,B03,B04,B08,B11), off the main thread.
import { fromArrayBuffer } from "geotiff";
import { selectBands } from "./lib";

self.onmessage = async (e: MessageEvent<ArrayBuffer>) => {
  try {
    const img = await (await fromArrayBuffer(e.data)).getImage();
    const W = img.getWidth(), H = img.getHeight(), nb = img.getSamplesPerPixel();
    const sel = selectBands(nb);
    if ("error" in sel) return (self as any).postMessage({ error: sel.error });
    const r = (await img.readRasters({ samples: sel.idx, interleave: false })) as unknown as ArrayLike<number>[];
    const planar = new Uint16Array(5 * W * H);
    // float exports hold reflectance (<=~2); integer ones hold DN = refl*1e4
    const f = r[0] instanceof Float32Array || r[0] instanceof Float64Array ? 1e4 : 1;
    r.forEach((b, k) => { for (let p = 0; p < W * H; p++) planar[k * W * H + p] = Math.max(0, Math.min(65535, Math.round(b[p] * f))); });
    (self as any).postMessage({ W, H, nb, planar }, [planar.buffer]);
  } catch (err: any) { (self as any).postMessage({ error: String(err?.message ?? err) }); }
};
