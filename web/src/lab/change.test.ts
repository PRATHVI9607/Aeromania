import { describe, expect, it } from "vitest";
import { detectChange } from "./change";
import { aoiBoxes, inBox, nearest, parseLatLon, SITING_BOX, utm } from "./geo";

const W = 80, H = 80, N = W * H;
// B02,B03,B04,B08,B11 reflectance
const VEG = [0.03, 0.06, 0.04, 0.35, 0.15], BARE = [0.05, 0.08, 0.2, 0.2, 0.3];
function scene(paint: (x: number, y: number) => number[]) {
  const a = new Uint16Array(5 * N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paint(x, y).forEach((v, b) => { a[b * N + y * W + x] = Math.round(v * 1e4); });
  return a;
}
const patch = (x0: number, y0: number, s: number) => (x: number, y: number) => (x >= x0 && x < x0 + s && y >= y0 && y < y0 + s ? BARE : VEG);

describe("change rules (painted patch, python/herald/change.py behaviour)", () => {
  const valid = new Uint8Array(N).fill(1), t0 = scene(() => VEG);
  it("20x20 veg->bare patch = 4.00 ha construction (cleared), 4x4 speck dropped by min_px", () => {
    const t1 = scene((x, y) => (x < 20 && y < 20 ? BARE : x >= 60 && x < 64 && y >= 60 && y < 64 ? BARE : VEG));
    const c = detectChange(t0, t1, W, H, valid);
    expect(c.ha.construction).toBeCloseTo(4.0);
    expect(c.ha.cleared).toBeCloseTo(4.0);
    expect(c.ha.built).toBe(0);
  });
  it("same patch is forest loss (forest_ndvi 0.5, >=45 px) and not a mine without a bare t0 patch", () => {
    const c = detectChange(t0, scene(patch(10, 10, 20)), W, H, valid);
    expect(c.ha.forestLoss).toBeCloseTo(4.0);
    expect(c.ha.mine).toBe(0);
  });
  it("invalid pixels are excluded; no change gives zero", () => {
    expect(detectChange(t0, scene(patch(10, 10, 20)), W, H, new Uint8Array(N)).ha.construction).toBe(0);
    expect(detectChange(t0, t0, W, H, valid).ha.construction).toBe(0);
  });
  it("loss touching a >=10 ha bare t0 patch is mine expansion", () => {
    // 100x100 px = 100 ha bare at t0 would exceed our canvas; use a wide strip: bare 80x13 = 1040 px >= mine_min_px 1000
    const x0 = scene((x, y) => (y < 13 ? BARE : VEG));
    const x1 = scene((x, y) => (y < 13 || (x >= 10 && x < 30 && y >= 14 && y < 34) ? BARE : VEG));
    const c = detectChange(x0, x1, W, H, valid);
    expect(c.ha.mine).toBeCloseTo(4.0);
    expect(c.ha.forestLoss).toBe(0);
  });
});

describe("lat/lon parser", () => {
  it("accepts common forms", () => {
    expect(parseLatLon("13.10, 77.51")).toEqual({ lat: 13.1, lon: 77.51 });
    expect(parseLatLon("22.83 82.80")).toEqual({ lat: 22.83, lon: 82.8 });
    expect(parseLatLon("13.1N 77.5E")).toEqual({ lat: 13.1, lon: 77.5 });
    expect(parseLatLon("13.1S, 77.5W")).toEqual({ lat: -13.1, lon: -77.5 });
  });
  it("rejects junk and out-of-range", () => {
    for (const s of ["", "abc", "13.1", "95, 77", "13, 200", "13,77,5"]) expect(parseLatLon(s)).toBeNull();
  });
});

describe("AOI lookup + UTM", () => {
  const tiles = [0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map((j) => ({ aoi: "x", lat: 13 + i * 0.006, lon: 77 + j * 0.006 })));
  it("point in/out of box", () => {
    const [b] = aoiBoxes(tiles);
    expect(inBox(b, { lat: 13.01, lon: 77.01 })).toBe(true);
    expect(inBox(b, { lat: 14, lon: 77.01 })).toBe(false);
    expect(inBox(SITING_BOX, { lat: 14.0, lon: 77.3 })).toBe(true);
  });
  it("nearest within radius", () => {
    expect(nearest(tiles, { lat: 13.0061, lon: 77.0001 }, 1)?.x.lat).toBeCloseTo(13.006);
    expect(nearest(tiles, { lat: 20, lon: 80 }, 1)).toBeNull();
  });
  it("UTM matches the vault grid (blr tile origin 769020 E)", () => {
    const u = utm({ lat: 13.10428, lon: 77.51704 }, 43);
    expect(u.x).toBeGreaterThan(769020); expect(u.x).toBeLessThan(769020 + 46 * 640);
    expect(u.y).toBeLessThan(1472420); expect(u.y).toBeGreaterThan(1472420 - 46 * 640);
  });
});

import { readFileSync } from "node:fs";
import { lookup, type Ctx } from "./offline";
import { solarEcon } from "./online";

const J = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, "utf-8"));
const tj = J("tiles.json");
const ctx: Ctx = {
  tiles: tj.rows.map((r: any[]) => ({ ...Object.fromEntries(tj.fields.map((f: string, k: number) => [f, r[k]])) })),
  sites: J("reports/sites_blr.json").sites, siting: J("siting.json"), siteIdx: J("sites_index.json"), cards: J("evidence.json").cards,
};
describe("offline point lookup (real generated files)", () => {
  it("Bengaluru top lead", () => {
    const r = lookup({ lat: 13.104, lon: 77.517 }, ctx);
    expect(r.aoi).toBe("blr");
    expect(r.a1.v.text).toBe("New construction detected");
    expect(r.a1.site.rank).toBe(1);
    expect(r.c.v.tone).toBe("dim");
  });
  it("Hasdeo point is inside the AOI and answers C", () => {
    const r = lookup({ lat: 22.83, lon: 82.8 }, ctx);
    expect(r.aoi).toBe("hasdeo");
    expect(r.c.v.tone).not.toBe("dim");
    expect(r.a1.v.tone).toBe("dim");
  });
  it("Pavagada shortlist and outside coverage", () => {
    const p = lookup({ lat: 14.1788, lon: 77.0631 }, ctx);
    expect(p.a2.v.text).toContain("rank 1");
    const o = lookup({ lat: 28.6, lon: 77.2 }, ctx);
    expect([o.a1.v.text, o.a2.v.text, o.c.v.text]).toEqual(["Outside coverage", "Outside coverage", "Outside coverage"]);
  });
});

describe("solar econ", () => {
  it("Pavagada GHI 5.66, T2M 25.8 -> CUF 0.166 as in siting.json", () => {
    const S = J("reports/siting.json").params.solar;
    expect(solarEcon({ ghi: 5.66, t2m: 25.8, ws50: 6 }, S).cuf).toBeCloseTo(0.166, 2);
  });
});
