import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardsFromText, chainMeta } from "../canon";
import { fits, linkBudget, within } from "./link";
import { chainStatus, tamperNodes } from "./tamper";

describe("link budget", () => {
  const b = linkBudget({ altKm: 786, minElDeg: 10, mbps: 100, eff: 0.7, rho: 1 });
  it("matches sim physics (10.56 min, 5.54 GB) within 2%", () => {
    const sim = JSON.parse(readFileSync("public/data/reports/sim.json", "utf-8")).physics;
    expect(within(b.maxPassMin, sim.max_pass_min, 0.02)).toBe(true);
    expect(within(b.bytesPerPass / 1e9, sim.gb_per_max_pass, 0.02)).toBe(true);
  });
  it("geometry sanity", () => {
    expect(b.periodMin).toBeGreaterThan(100); expect(b.periodMin).toBeLessThan(101);
    expect(b.slantKm).toBeGreaterThan(2200); expect(b.slantKm).toBeLessThan(2500);
    expect(linkBudget({ altKm: 786, minElDeg: 10, mbps: 100, eff: 0.7, rho: 5 }).bytesEffective).toBeCloseTo(b.bytesPerPass / 5, 0);
    expect(fits(1000, 300)).toBe(3);
  });
});

describe("tamper", () => {
  const text = readFileSync("public/data/evidence.json", "utf-8");
  const { cards, nodes } = cardsFromText(text), m = chainMeta(text);
  it("clean chain verifies; one flipped char breaks that card and all later ones", async () => {
    expect((await chainStatus(cards, nodes, m.genesis, m.head)).ok.every(Boolean)).toBe(true);
    const t = tamperNodes(nodes, 3, "ha")!;
    expect(t.after).not.toBe(t.before);
    const s = await chainStatus(cards, t.nodes, m.genesis, m.head);
    expect(s.ok.map((x) => (x ? 1 : 0)).join("")).toBe("1110" + "0".repeat(cards.length - 4));
  });
});
