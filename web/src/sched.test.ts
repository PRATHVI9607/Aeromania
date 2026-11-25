import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { run, prepare, POLICIES } from "./sched";

// Fixture produced by python (herald.sched.run): { params, queries, tiles, windows, runs: {"<rho>/<policy>": {sel, metrics}} }
const path = process.env.PARITY_FIXTURE ?? resolve(__dirname, "../../python/tests/fixtures/sched_parity.json");
const have = existsSync(path);
if (!have) console.warn(`sched parity fixture missing: ${path}`);

describe.skipIf(!have)("scheduler parity with python", () => {
  const fx = have ? JSON.parse(readFileSync(path, "utf-8")) : null;
  const rel = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  for (const key of Object.keys(fx?.runs ?? {})) {
    it(key, () => {
      const [rho, pol] = key.split("/");
      expect(POLICIES).toContain(pol);
      const prep = prepare(fx.tiles, fx.queries, fx.params);
      const out = run(pol as any, fx.tiles, fx.windows, fx.params, fx.queries, +rho, prep);
      const want = fx.runs[key];
      expect(out.sel).toEqual(want.sel);
      for (const k of Object.keys(want.metrics)) {
        const a = (out.metrics as any)[k], b = want.metrics[k];
        if (b === null || a === null) expect(a).toBe(b);
        else expect(rel(a, b), `${k}: ${a} vs ${b}`).toBe(true);
      }
    });
  }
});
