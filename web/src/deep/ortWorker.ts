// Runs the int8 model off the main thread. Messages: {type:"init"} -> {type:"ready"|"error"}, {type:"run", id, x, n} -> {type:"out"|"error"}.
import * as ort from "onnxruntime-web/wasm";

let session: ort.InferenceSession | null = null;
self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      const t0 = performance.now();
      ort.env.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
      ort.env.wasm.wasmPaths = new URL("/model/ort/", self.location.origin).href;
      session = await ort.InferenceSession.create(new URL("/model/herald_int8.onnx", self.location.origin).href, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      (self as any).postMessage({ type: "ready", loadMs: performance.now() - t0, threads: ort.env.wasm.numThreads });
    } else if (m.type === "run") {
      const t0 = performance.now();
      const r = await session!.run({ x: new ort.Tensor("float32", m.x, [m.n, m.c, m.h, m.w]) });
      const ms = performance.now() - t0;
      const logits = new Float32Array(r.logits.data as Float32Array), cloud = new Float32Array(r.cloud.data as Float32Array);
      (self as any).postMessage({ type: "out", id: m.id, ms, logits, cloud }, [logits.buffer, cloud.buffer]);
    }
  } catch (err: any) {
    (self as any).postMessage({ type: "error", id: m.id, message: String(err?.message ?? err) });
  }
};
