import { runAll } from "./sched";
import type { Params, Query, Tile, Window } from "./types";

let tiles: Tile[] = [], wins: Window[] = [], params: Params;
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "init") { tiles = m.tiles; wins = m.wins; params = m.params; return; }
  if (m.type === "run") {
    const out = runAll(tiles, wins, params, m.queries as Query[], m.rho);
    // sel is a long list of tuples; fine to structured-clone at this size
    (self as unknown as Worker).postMessage({ type: "out", seq: m.seq, out });
  }
};
