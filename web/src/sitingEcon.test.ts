import { describe, expect, it } from "vitest";
import { reprice, type SitePar } from "./sitingEcon";

const base: SitePar = { wacc: 0.095, life_yr: 25, om_lakh_per_mw_yr: 4, capex_cr_per_mw: 3.7, grid_cr_per_km: 0.8, road_cr_per_km: 0.5, tariff_rs_kwh: 2.6 };
// rank 1 solar candidate from siting.json
const c = { mw: 21.5, mwh_yr: 31274, revenue_rs_yr: 81313171, net_value_rs_yr: -11776279, grid_km_substation: 0.4, road_km: 0 };
describe("reprice", () => {
  it("reproduces the generated net and lcoe at base parameters", () => {
    const r = reprice(c, base, base);
    expect(Math.abs(r.net - c.net_value_rs_yr)).toBeLessThan(2000); expect(r.lcoe).toBeCloseTo(2.98, 2); expect(r.viable).toBe(false);
  });
  it("higher tariff raises revenue and flips viability; lower capex lowers lcoe", () => {
    expect(reprice(c, base, { ...base, tariff_rs_kwh: 3.5 }).viable).toBe(true);
    expect(reprice(c, base, { ...base, capex_cr_per_mw: 3.1 }).lcoe).toBeLessThan(2.98);
  });
});
