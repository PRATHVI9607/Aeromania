import { useEffect, useRef, useState } from "react";
import type { Query, SchedOut, Tile, Params, Window } from "./types";

export function useSched(tiles: Tile[], wins: Window[], params: Params, queries: Query[], rho: number) {
  const w = useRef<Worker | null>(null);
  const seq = useRef(0), sent = useRef(new Map<number, number>());
  const [out, setOut] = useState<SchedOut | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [runs, setRuns] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const wk = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    wk.onmessage = (e) => {
      const t = sent.current.get(e.data.seq);
      if (t !== undefined) { setMs(performance.now() - t); setRuns((n) => n + 1); sent.current.delete(e.data.seq); }
      if (e.data.seq === seq.current) setOut(e.data.out);
    };
    wk.onerror = (e) => { e.preventDefault(); setErr(`scheduler worker failed: ${e.message || "unknown error"}`); console.error("[HERALD sched]", e.message); };
    wk.postMessage({ type: "init", tiles, wins, params });
    w.current = wk;
    return () => wk.terminate();
  }, [tiles, wins, params]);
  useEffect(() => {
    const s = ++seq.current;
    sent.current.set(s, performance.now());
    w.current?.postMessage({ type: "run", seq: s, queries, rho });
  }, [queries, rho, tiles, wins, params]);
  return { out, ms, runs, err };
}
