import type { Data } from "./data";
import type { Explain } from "./kit";
import { inr } from "./fmt";

const f = (x: unknown, d = 2) => (typeof x === "number" && isFinite(x) ? x.toFixed(d) : "n/a");
const pc = (x: unknown, d = 0) => (typeof x === "number" ? `${(x * 100).toFixed(d)}%` : "n/a");

/** Per-view explainer copy. Every threshold and parameter is read from the generated JSON, so the text cannot drift from the run. */
export function explain(id: string, d: Data): Explain {
  const R = d.reports, p = d.params;
  const th = R.change_blr_summary?.summary?.thresholds ?? {}, thH = R.change_hasdeo_summary?.summary?.thresholds ?? {};
  const sv = R.survey_blr, sb = R.sites_blr, lead = R.audit_blr_lead, sim = R.sim, m = R.model, sit = R.siting?.params;
  const r5 = sim?.by_rho?.[5];
  switch (id) {
    case "ledger": return {
      what: <>Every place in north Bengaluru where land changed into new construction between {sv?.dates?.[0]?.slice(0, 10)} and {sv?.dates?.[1]?.slice(0, 10)}, as ranked leads: a map, a filterable table, size and ward charts, and a detail panel with native 10 m pixels for each lead.</>,
      why: <>City revenue teams can rank wards for property-tax survey (new built-up that is not on the roll), planners see growth against roads and water, and lake authorities see building near no-build buffers. Payer: the city, at {inr(sv?.rupees_per_ha_A ?? p.rupees_per_ha.A)} per ha of new built-up (assumption).</>,
      how: [
        <>Per 10 m pixel, compare the two Sentinel-2 dates: NDVI falls by at least {th.a_dndvi}, NDBI does not fall (dNDBI above {th.b_dndbi}), BSI rises by at least {th.c_dbsi}, and the t1 NDVI stays under {th.ndvi1_max}.</>,
        <>Keep connected changed areas of at least {th.min_px} pixels ({((th.min_px ?? 25) * 0.01).toFixed(2)} ha); report sites of at least {sb?.min_site_ha} ha.</>,
        <>A site is a new layout when its road density exceeds {th.layout_density} with at least {th.layout_min_road_px} road pixels in a consistent grid direction; a building when built fraction is above {th.building_frac}. Cleared land with neither stays "ambiguous".</>,
        <>Confidence is the reviewer-audit precision of the category, not a per-site probability. Lake buffers follow the KTCDA size tiers; drains come from OSM.</>,
      ],
      caveats: [
        <>Precision {f(lead?.precision_excl_unsure)} excluding unsure ({lead?.real} real, {lead?.wrong} wrong, {lead?.unsure} unsure of {lead?.n}). It is a reviewer visual audit, not field verification.</>,
        <>Sentinel-2 absolute location is about 12 m, so a lead cannot settle a parcel line. Check the registry before any action.</>,
        <>Layout versus building is unreliable at 10 m, so the two are merged as "new construction". Lake leads: 0 of 10 confirmed filling.</>,
      ] };
    case "siting": return {
      what: <>A 60 by 60 km box around Pavagada, Karnataka, scored cell by cell for utility solar and wind, with the top 20 sites, their energy and revenue, and the reasons each one ranks.</>,
      why: <>A renewable developer or state nodal agency wants candidate land before paying for surveys. The check that matters: does the method rank the real Pavagada solar park highly without being told where it is?</>,
      how: [
        <>Solar cell score = usable land share x slope share (slope up to {sit?.solar?.max_slope_deg?.v} degrees) x irradiance (NASA POWER GHI), with WorldCover class weights; cropland counts for less because farmland is slow to buy.</>,
        <>Capacity MW = usable ha / {sit?.solar?.ha_per_mw?.v} ha per MW; energy uses a performance ratio of {sit?.solar?.pr?.v}; revenue uses {sit?.solar?.tariff_rs_kwh?.v} Rs/kWh. All three are assumptions.</>,
        <>Net margin subtracts capex ({sit?.solar?.capex_cr_per_mw?.v} Cr/MW), grid connection by distance to the nearest substation and 33 kV line, and operating cost.</>,
        <>Validation reads the cells inside the OSM footprint of the Pavagada park and reports their percentile among ranked cells.</>,
      ],
      caveats: [
        <>NASA POWER is native 0.5 to 1 degree: irradiance is a smooth interpolation, and ridge-top wind is not resolved.</>,
        <>Slope share and land-use share are multiplied as if independent. Screening ranks, not site surveys.</>,
        <>Every rupee value is an assumption from config/siting.json; hover the amounts for the source.</>,
      ] };
    case "mission": return {
      what: <>The satellite's orbit and ground contacts on a 3D globe: where each tile was captured, which ground station can receive it, and which tiles the scheduler sends first.</>,
      why: <>Contact time with a ground station is the scarce resource: a pass lasts at most {f(sim?.physics?.max_pass_min, 1)} min and carries about {f(sim?.physics?.gb_per_max_pass, 1)} GB. The globe shows why choosing what to send matters.</>,
      how: [
        <>Orbit from a circular sun-synchronous model: period {f(sim?.physics?.period_kepler_min, 1)} min, inclination {f(sim?.physics?.inclination_deg, 1)} degrees, altitude {f(sim?.physics?.mean_alt_km, 0)} km, swath {sim?.physics?.swath_km} km.</>,
        <>Contact windows are the intervals when the satellite is above the horizon of a ground station in config/stations.json; windows are split at capture times.</>,
        <>Each tile gets a value (changed ha x priority x rupees per ha) and the scheduler fills each window's byte budget at {p.link_mbps} Mbps x {p.link_efficiency} efficiency.</>,
      ],
      caveats: [
        <>Archived imagery replayed as if captured now; no satellite flew. The capture day index is synthetic; time of day follows real orbit geometry.</>,
        <>One satellite. Constellation size enters only through the oversubscription factor rho.</>,
      ] };
    case "fifo": return {
      what: <>A race between four ways of using the same antenna time: FIFO, cloud-filter, HERALD by value (H1) and HERALD with a thumbnail first (H2). The curves show cumulative value delivered against contact minutes.</>,
      why: <>Operators pay for contact minutes ({inr(p.rupees_per_contact_min)} per minute, assumption). The question is how much of the achievable value arrives per minute, and how soon the first usable answer lands.</>,
      how: [
        <>Value of a tile = changed ha x rupees per ha (A: {inr(p.rupees_per_ha.A)}, C: {inr(p.rupees_per_ha.C)}) x customer priority x cloud factor, decayed with a half-life of {p.half_life_h} h.</>,
        <>Tiles are sent at three levels: packet ({p.level_bytes[0]} B), thumbnail ({p.level_bytes[1]} B) and full chip, carrying {p.level_fraction.map((x) => pc(x)).join(" / ")} of the value. A tile above {inr(p.pull_threshold)} is pulled at full size; cloud above {pc(p.cloud_drop)} is dropped.</>,
        <>Upper bound (UB) is the fractional-knapsack relaxation over all windows. Percentages compare each policy with UB at oversubscription rho (the ratio of captured data to link capacity).</>,
      ],
      caveats: [
        <>At rho 5, HERALD reaches {pc(r5?.pct_ub?.H2, 1)} of UB and FIFO {pc(r5?.pct_ub?.B1, 1)}. The gap is large because FIFO sends cloudy and empty tiles first; it is not a claim about any real operator.</>,
        <>UB is a relaxation, not an optimum. Rupee values are assumptions. Simulation, not a flight result.</>,
      ] };
    case "queries": return {
      what: <>The live scheduler: each standing query is a customer's interest in an area and a severity threshold. Change priorities, add a query, and the downlink order is recomputed in a web worker.</>,
      why: <>Shows that tasking is a data decision, not a manual one: when a customer's priority changes, the order of what comes down changes in milliseconds, and the change is visible in the ranked list.</>,
      how: [
        <>The scheduler (same code as the Python reference, checked by a parity test) scores tiles per query as sev above min_sev x priority x rupees per ha.</>,
        <>Tiles are sorted by value per byte and packed into each contact window; the round-trip time is shown above and used by gate G6 (under 60 ms).</>,
      ],
      caveats: [<>Browser timing depends on this machine. Query priorities and rupee values are assumptions.</>] };
    case "evidence": return {
      what: <>Hash-chained evidence cards for forest lost to open-cast mining at Hasdeo Arand (and experimental sand-mining leads on the Sone), each with the two dates, index changes, Sentinel-1 radar change and native-resolution crops.</>,
      why: <>A forest or mines department needs a record that a given patch changed between two dates, and that nobody edited the record afterwards. The chain proves the second; the imagery supports the first.</>,
      how: [
        <>Mine expansion: bare, non-water change of at least {thH.mine_min_px} pixels touching forest (NDVI at t0 above {thH.forest_ndvi}, dNDVI at least {thH.d_ndvi}).</>,
        <>Each card is serialised as canonical JSON, hashed with SHA-256 and linked to the previous card's hash; images carry their own SHA-256 inside the card.</>,
        <>Verify chain recomputes every hash in your browser and checks links back to the genesis hash. A one-character edit fails it (gate G16).</>,
      ],
      caveats: [
        <>Mine-expansion audit precision {pc(R.audit_trackc?.precision?.hasdeo?.mine_expansion)}; forest clearing {pc(R.audit_trackc?.precision?.hasdeo?.forest_clearing)}; sand pits {pc(R.audit_trackc?.precision?.sone?.sand_pits)}. Reviewer audit, not field-verified.</>,
        <>Sand mining at 10 m is experimental and weak. Land cover only, never people. Tamper evidence is not legal admissibility.</>,
      ] };
    case "model": return {
      what: <>The onboard classifier and how fast it runs, measured on a host CPU, plus the cloud-fraction and land-cover heads that decide what is worth downlinking.</>,
      why: <>Onboard compute budget decides whether classification can happen in orbit at all. The question is accuracy after int8 quantisation and milliseconds per chip.</>,
      how: [
        <>Backbone: {String(m?.backbone ?? "n/a").slice(0, 80)}, fine-tuned on EuroSAT; held-out top-1 {pc(m?.eurosat?.top1_int8, 2)} int8 vs {pc(m?.eurosat?.top1_fp32, 2)} fp32 (n={m?.eurosat?.n_test}).</>,
        <>Latency is the median of 30 runs after 5 warmups, amortised per chip. Calibration uses temperature scaling (ECE {f(m?.eurosat?.ece_after, 4)}).</>,
      ],
      caveats: [<>Laptop CPU under load, not flight hardware; no Raspberry Pi or ESP32 was used. Flight latency is not claimed. Cloud MAE {f(m?.cloud?.mae, 3)} on a held-out AOI misses the 0.05 target.</>] };
    case "econ": return {
      what: <>Four payers, what each would buy, and the rupee arithmetic with every input exposed.</>,
      why: <>Shows who pays and on what basis, so the value used by the scheduler is checkable rather than asserted.</>,
      how: [
        <>Each figure is quantity (ha, MW, contact minutes) x a named parameter from config/value.json or config/siting.json.</>,
        <>Hover or focus any amount for the parameter name, value and source note.</>,
      ],
      caveats: [<>Nothing here is a measured saving. Every economic number is an assumption.</>] };
    case "gates": return {
      what: <>Every acceptance target in the project, the number we measured, and whether it passed. Misses stay visible.</>,
      why: <>A prototype is only as credible as its failures are visible. This is the full list, including the targets we missed.</>,
      how: [
        <>Values are read from the generated report JSONs when the page loads; a missing field shows pending, never a made-up value.</>,
        <>G6 is measured live in this browser; G16 re-verifies the evidence chain and a single-character tamper.</>,
      ],
      caveats: [<>Reviewer audits are not field verification. See the limitations list below the gates.</>] };
  }
  return { what: "", why: "", how: [], caveats: [] };
}
