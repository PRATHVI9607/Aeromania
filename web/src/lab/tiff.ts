// GeoTIFF bytes -> planar uint16 via the worker (the buffer is transferred)
export function worker(buf: ArrayBuffer) {
  return new Promise<{ W: number; H: number; planar: Uint16Array }>((res, rej) => {
    const w = new Worker(new URL("./tiffWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => { w.terminate(); e.data.error ? rej(new Error(e.data.error)) : res(e.data); };
    w.onerror = (e) => { w.terminate(); rej(new Error(e.message || "tiff worker failed")); };
    w.postMessage(buf, [buf]);
  });
}
