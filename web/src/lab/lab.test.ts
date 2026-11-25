import { describe, expect, it } from "vitest";
import { C, P, plan, pRel, selectBands, tile } from "./lib";

describe("tile", () => {
  it("cuts 64x64 chips in row-major order and drops edges", () => {
    const W = 150, H = 130, pl = new Uint16Array(5 * W * H);
    for (let b = 0; b < 5; b++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pl[b * W * H + y * W + x] = b * 10000 + y * 100 + x;
    const { chips, cols, rows } = tile(pl, W, H);
    expect([cols, rows, chips.length]).toEqual([2, 2, 4 * 5 * P]);
    const L = 5 * P; // chip (row1,col1), band 3, pixel (2,5) -> source (64+2, 64+5)
    expect(chips[(1 * 2 + 1) * L + 3 * P + 2 * C + 5]).toBe(30000 + 66 * 100 + 69);
  });
});

describe("selectBands", () => {
  it("5 / 13 / 12 / 3 bands", () => {
    expect(selectBands(5)).toEqual({ idx: [0, 1, 2, 3, 4] });
    expect(selectBands(13)).toEqual({ idx: [1, 2, 3, 7, 11] });
    expect(selectBands(12)).toEqual({ idx: [1, 2, 3, 7, 10] });
    expect("error" in selectBands(3)).toBe(true);
    expect("error" in selectBands(4)).toBe(true);
  });
});

describe("value and plan", () => {
  it("sums relevant classes", () => {
    const cls = ["Forest", "Highway", "Industrial", "Residential"];
    expect(pRel([0.4, 0.1, 0.2, 0.3], cls)).toBeCloseTo(0.6);
  });
  it("HERALD beats FIFO and respects capacity", () => {
    const items = [{ value: 0, bytes: 10 }, { value: 0, bytes: 10 }, { value: 9, bytes: 10 }, { value: 5, bytes: 10 }];
    const p = plan(items, 20);
    expect(p.herald).toEqual([2, 3]);
    expect(p.fifo).toEqual([0, 1]);
    expect(p.heraldPct).toBeCloseTo(100);
    expect(p.fifoPct).toBe(0);
  });
});
