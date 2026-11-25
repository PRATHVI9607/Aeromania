export interface SitePar { wacc: number; life_yr: number; om_lakh_per_mw_yr: number; capex_cr_per_mw: number; grid_cr_per_km: number; road_cr_per_km: number; tariff_rs_kwh: number }
export interface Cand { mw: number; mwh_yr: number; revenue_rs_yr: number; net_value_rs_yr: number; grid_km_substation: number; road_km: number }
const crf = (P: SitePar) => P.wacc / (1 - (1 + P.wacc) ** -P.life_yr);
/** Annual cost, same formula as python/herald/siting.py econ(): O&M + annualised capex + annualised grid and road build. */
export const cost = (c: Cand, P: SitePar) =>
  c.mw * (P.om_lakh_per_mw_yr * 1e5 + P.capex_cr_per_mw * 1e7 * crf(P)) + (c.grid_km_substation * P.grid_cr_per_km + c.road_km * P.road_cr_per_km) * 1e7 * crf(P);
/** Re-price one generated candidate under edited tariff and capex. Exact at the base parameters: the file's own cost is the anchor and only the change is added. */
export function reprice(c: Cand, base: SitePar, now: SitePar) {
  const costBase = c.revenue_rs_yr - c.net_value_rs_yr, cst = costBase + cost(c, now) - cost(c, base);
  const rev = c.mwh_yr * 1000 * now.tariff_rs_kwh;
  return { revenue: rev, net: rev - cst, lcoe: cst / Math.max(c.mwh_yr * 1000, 1e-9), cost: cst, viable: cst / Math.max(c.mwh_yr * 1000, 1e-9) < now.tariff_rs_kwh };
}
