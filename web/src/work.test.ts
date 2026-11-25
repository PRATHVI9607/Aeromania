import { describe, expect, it } from "vitest";
import { applyPatch, countStatus, LEAD_STATUS, statusOf, toCSV, toGeoJSON, toKML } from "./work";

describe("status store", () => {
  it("defaults to new and patches many ids", () => {
    const s = applyPatch({}, ["a", "b"], { status: "inspect", assignee: "R. Nair" }, "t");
    expect(statusOf(s, "a")).toBe("inspect"); expect(statusOf(s, "zzz")).toBe("new");
    expect(s.b).toEqual({ status: "inspect", note: "", assignee: "R. Nair", updated: "t" });
  });
  it("keeps other fields when patching one", () => {
    const s = applyPatch(applyPatch({}, ["a"], { note: "gate locked" }, "t1"), ["a"], { status: "escalated" }, "t2");
    expect(s.a).toMatchObject({ note: "gate locked", status: "escalated", updated: "t2" });
  });
  it("counts including untouched ids as new", () => {
    const s = applyPatch({}, ["a"], { status: "dismissed" });
    expect(countStatus(s, ["a", "b", "c"], LEAD_STATUS)).toEqual({ new: 2, inspect: 0, dismissed: 1, approved: 0, escalated: 0 });
  });
});
describe("exports", () => {
  it("csv escapes commas, quotes and newlines", () => {
    expect(toCSV([{ a: 'x,"y"', b: "l1\nl2", c: 3 }], ["a", "b", "c"])).toBe('a,b,c\r\n"x,""y""","l1\nl2",3\r\n');
  });
  it("geojson is lon,lat ordered", () => {
    const g = toGeoJSON([{ lat: 13.1, lon: 77.5, name: "n", props: { ha: 2 } }]);
    expect(g.features[0].geometry.coordinates).toEqual([77.5, 13.1]); expect(g.features[0].properties).toEqual({ name: "n", ha: 2 });
  });
  it("kml escapes markup and orders lon,lat", () => {
    const k = toKML([{ lat: 1, lon: 2, name: "a<b", props: { n: "x&y" } }]);
    expect(k).toContain("<coordinates>2,1,0</coordinates>"); expect(k).toContain("a&lt;b"); expect(k).toContain("x&amp;y");
  });
});
