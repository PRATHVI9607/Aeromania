# HERALD — Judge Q&A prep

For: the presenting team, 5-minute pitch + Q&A with Boeing judges.
Rule: answer in one or two sentences, then give one number. Never claim more than the "Measured" column in PRD "Targets v5". Items marked ⏳ get filled from `reports/*.json` before the demo.

---

## 1. The idea and why it matters

**Q: What is HERALD in one line?**
A satellite that sends home answers, not pictures. An onboard AI scores every tile, and a scheduler fills each ground-station contact with the highest rupee value per byte.

**Q: Why is downlink a real problem?**
A Sentinel-2-class satellite gets ~10-minute contacts (max pass 10.56 min in our orbit model, ≈ 5.5 GB at 100 Mbps × 0.7). It captures far more than that, so today data waits in capture order (FIFO) and the valuable tiles wait behind cloudy and empty ones.

**Q: Isn't onboard AI already done (Φ-Sat-1 / CloudScout)?**
Yes, onboard cloud filtering exists, and we cite it. Our novelty is the decision layer: calibrated scores → rupee value per customer query → value-per-byte scheduling with progressive packets. A CloudScout-style cloud filter (our baseline B2) is still 20× behind HERALD at ρ = 5, because most wasted bytes are cloud-free tiles with no change, not cloud.

**Q: Why should Boeing care?**
Boeing builds satellites. Every satellite is bandwidth-limited. Software that raises the value per downlinked byte raises the value of every spacecraft without new hardware, and it runs on the onboard computers satellites already carry.

---

## 2. Data and realism

**Q: Is this real data or simulated?**
The imagery is real: Sentinel-2 L2A for 3 Indian areas on 4 real dates each (25,392 chips), plus Sentinel-1 radar. The orbit, contact windows and capture timeline are simulated: we replay archived images as if they were captured live. The PRD says so, and so does the About/Limits view.

**Q: Why these places?**
- Bengaluru north: the city's fastest-growing corridor (airport, aerospace park), with known lake and layout problems.
- Sone river at Koilwar: a documented illegal sand-mining hotspot.
- Hasdeo Arand: active forest clearing next to open-cast coal mines.
- Pavagada: home of a 2 GW solar park, which validates the siting ranking.

**Q: How did you pick dates? Couldn't seasons fake a change?**
We use the same season in both years (Feb 2023 vs Feb 2025, 0% cloud inside the area) to cancel seasonal effects. Leftover crop-cycle effects are separated into an `agri_ambiguous` category, not counted as construction.

**Q: L2A or L1C? A satellite would only have raw data onboard.**
We use L2A (surface reflectance) for clean indices. Flight would use top-of-atmosphere data. Our classifier is trained on EuroSAT, which is TOA data, so this domain gap is stated, not hidden.

**Q: Can it run without the internet?**
Yes. After the one-time `vault build`, everything (pipeline + dashboard) runs offline. No API keys, no Cesium ion, no paid services.

---

## 3. The onboard AI model

**Q: What model?**
ResNet-18 pretrained self-supervised on Sentinel-2 (SSL4EO-S12 MoCo), with conv1 sliced to 5 bands, fine-tuned multi-task. It outputs land-cover class, cloud fraction, a 64-d embedding, and an India land-cover head (WorldCover classes, ⏳). Exported to ONNX and quantized to int8.

**Q: Accuracy?**
EuroSAT held-out test: 98.11% fp32, 98.02% int8 (0.11 pt drop). Calibration error (ECE) 0.0065 after temperature scaling.

**Q: EuroSAT is Europe. Does it work on India?**
The EuroSAT head does not prove that, and we say so. That is why (a) change detection uses physics indices, which work on any land, and (b) we added a head trained on our own Indian chips against ESA WorldCover with a spatial hold-out: ⏳ % agreement (WorldCover itself is ≈ 77% accurate).

**Q: Why calibrate?**
The scheduler multiplies probability × hectares × ₹. Uncalibrated softmax overstates confidence and mis-ranks tiles. ECE went from 0.087 to 0.0065.

**Q: How fast? Is it really onboard-capable?**
int8 CPU: ⏳ ms/chip idle (1.10 ms measured while 6 build jobs loaded the laptop). A 41-hectare tile in about a millisecond means one CPU core keeps up with a full swath. Flight boards (ARM + NPU) would be faster.

**Q: Cloud detection accuracy?**
Mean error vs the satellite's own cloud mask: ⏳ (0.087 before adding cirrus training scenes, against a target of 0.05). The miss came from thin cirrus that our training scenes lacked. We fixed the data, not the metric. A flight design would also use the cirrus band (B10), which our 5-band input does not include.

**Q: Did anything not work?**
Yes. Using the embedding distance as an onboard change score scored AUC 0.56, barely better than chance, so we rejected it and say so. The embedding encodes land type, not change. Onboard change instead uses stored reference index maps (~3 KB per tile, ~6 MB per area) plus the same explainable rules.

---

## 4. Track A, objective 1: the construction ledger

**Q: What exactly do you detect?**
New construction between dates, at 10 m pixels, in categories: `new_layout` (road grids cut into farmland), `building_construction`, `agri_ambiguous` (field change, not construction), and lake leads. Minimum lead size 0.2 ha.

**Q: How accurate?**
- Lead precision by reviewer visual audit (not field-verified): 0.69, or 0.89 excluding unsure.
- Injected fake construction: recall 1.0 at 0.5 ha, 0.95 at 1 ha.
- Against OpenStreetMap construction polygons (weak, incomplete labels): precision 0.26, recall 0.32. That is why we don't lean on OSM.

**Q: Can you find illegal extra floors?**
No. At 10 m a house is about one pixel and height is invisible. We tip and cue instead: HERALD flags sites, and sub-metre imagery (e.g. ISRO Cartosat-3, 0.25 m) or an inspector checks only those. That means 20 checks instead of 20,000.

**Q: How do you know a site is an encroachment?**
We don't, and no satellite can. Encroachment is legal ownership. We overlay physical change on legal geometry we can compute (lake no-build buffers per the Supreme Court 2019 ruling and KTCDA 2025 tiers, drain proximity) and produce leads that need a registry or ground check.

**Q: A plot that is 90% legal and 10% illegal?**
Below our resolution. A 5–10 m spill across a property line can't be resolved, given ≈ 12.5 m absolute geolocation. Date-to-date alignment (≈ 0.3 px) makes change reliable, but not boundaries. That needs cadastral maps plus sub-metre imagery.

**Q: Lakes drying naturally vs being filled?**
- Drying: water → grass or bare soil with no structures. We ignore it.
- Desilting or rejuvenation works: water returns at a later date. We mark it "verify sanctioned works".
- Filling: water → built land or roads. That is a lead.

In our real data, 10 lake leads were audited and 0 were confirmed filling (dry-season drying and desilting). We report that instead of hiding it.

**Q: Government drain works or new roads look like change. Do you flag them?**
Thin changes along a mapped drain are `drain_works`, and long thin built lines are `linear_infra`. Neither is reported as an encroachment lead.

**Q: Is this actually needed? Who uses it?**
- Lake land: 10,472 acres found encroached, with notices to 11,595 encroachers (legislature committee, 2016-17).
- BBMP 2025: 472 acres identified, only 17.38 reclaimed.
- 696 drain encroachments found after the 2022 floods, which cost ORR firms ₹225 crore in one day.
- 279 unauthorised layouts listed by BDA.

Detection today is late and complaint-driven. Users: BBMP lake and drain divisions, the lake authority (KTCDA), BDA layout enforcement, the revenue department (new buildings missing from the tax roll), and planners.

**Q: The ₹ figures?**
Every rupee number on screen is labelled an assumption, with its source. Pack A: ~₹84,000 per hectare per year of recoverable property tax = ₹14,000/property (from the ~₹700 cr gap ÷ ~5 lakh unassessed properties) × 25 properties/ha (assumption) × 0.24 unassessed share.

**Q: What if the government itself is the encroacher?**
The ledger is dated, hashed and the same for everyone. It doesn't decide who is guilty; it makes the record hard to dispute later, which is what late reclamation lacks.

---

## 5. Track A, objective 2: renewable siting

**Q: How do you rank land?**
Per 1 km cell: NASA POWER irradiance and 50 m wind, Copernicus 30 m DEM slope, ESA WorldCover land use, and OSM grid lines and substations. Exclusions: water, wetland, built-up, dense forest, protected areas, steep slope. Score = LCOE in ₹/kWh versus the SECI auction tariff (₹2.6/kWh, 2025). Base capex ₹3.7 cr/MW (GoI ₹3.5–4 cr/MW range, 2025), WACC 9.5%, 25 yr. Best cell ₹2.72/kWh — 4.6% above tariff; viability flips at ₹3.1 cr/MW (2,613 of 2,883 cells viable). Insight: auction margins are wafer-thin, so location and scale decide who profits.

**Q: How do you know the ranking is right?**
We check it against reality: the real Pavagada Solar Park's cells rank at the 96th percentile (median), with 5 of 7 in the top 10%.

**Q: Wind?**
Not viable in this box at NASA POWER's 0.5° resolution. Karnataka's wind belt is the Chitradurga and Gadag ridges. Global Wind Atlas is the upgrade. We say so rather than force a result.

**Q: Why does a satellite company care about siting?**
Siting is a ground product, but HERALD keeps it current: when a top-ranked parcel gets built on, the construction ledger drops it, and new solar farms appear as a ledger category.

---

**Q: You tuned costs to make it look viable?**
No. Capex is a cited government range, not fitted. At the base case no cell beats the tariff, and we show that result.

**Q: Bengaluru's real pain is traffic. Can you help?**
Satellites at 10 m can't see traffic; that needs GPS or probe data. We show where it's heading: new construction hectares per km of mapped major road per ward ("growth outrunning roads"), plus construction near drains that cross major roads (the 2022 ORR flood cost ₹225 cr in one day). It's a planning indicator, not a traffic measurement.

## 6. Track B: orbit, scheduler, physics

**Q: Orbit numbers?**
Sentinel-2-like SSO at 786 km, 98.62°, 10:30 LTDN. Period 100.58 min (the textbook 100.43 doesn't fit 786 km; we report what we compute). Six real ground stations, 10° minimum elevation, max pass 10.56 min, 5.54 GB per max pass at 100 Mbps × 0.7.

**Q: Your archive is smaller than one pass. Where's the bottleneck?**
ρ = oversubscription: total contact capacity = archive ÷ ρ. It models many satellites, or many areas, sharing the same stations. We show the whole curve, not one point.

**Q: Isn't 27× cherry-picked?**
That's why we show the curve: 1.55× at ρ = 1, 8.6× at ρ = 2, 27.7× at ρ = 5, 57.8× at ρ = 10. The gap grows as bandwidth gets scarce. That is the mechanism: only ~26% of tiles carry any value, and the 2026 capture is 53% cloud, so FIFO spends its small budget on what it captured first. HERALD reaches FIFO's 5-day value in ~2 contact minutes. First insight: 25.4 min vs FIFO's 81.7 min at ρ = 5.

**Q: Does the win depend on your "packet = 70% of value" assumption?**
No. H1 sends full chips only, with no packets, and still gets 27.5× at ρ = 5. Changing the packet fraction from 0.3 to 0.7 moves H2 from 37.66× to 37.70× (earlier run). So the win comes from what is sent, not from the packet trick.

**Q: Is it optimal?**
No. It's greedy by value/byte, O(n log n), deterministic. We compare against an upper bound (fractional knapsack relaxation), labelled as a bound, not the optimum. Scheduler speed: 2.69 ms per 1,000 tiles.

**Q: Why are byte sizes realistic?**
Full-chip size is the measured zlib-compressed size of each chip, standing in for CCSDS-122. So cloudy and flat chips really are cheaper, like onboard compression.

**Q: Live demo: what happens when I add a customer query?**
The scheduler reruns in a browser Web Worker on 19,044 tiles in 35–50 ms, and the downlink order changes on screen. The Python and TypeScript schedulers are parity-tested: identical selections on 20 fixture cases.

**Q: Ground-station cost?**
AWS Ground Station publishes no per-minute price. Contact-minute cost is an editable assumption in the Economics view; we don't invent a vendor price.

---

## 7. Track C: mining into forest, sand mining, evidence

**Q: What's your strongest Track C result?**
Open-cast coal mines at Hasdeo Arand expanding into dense forest between Feb 2023 and Feb 2025. Mine-expansion leads have 0.88 reviewer-audit precision (7 real, 1 unsure, 0 wrong). There are 14 hash-chained evidence cards (10 Hasdeo, 4 Sone). The rupee value uses ₹4.38 lakh per hectare, the lowest forest NPV rate in the Supreme Court's Godavarman order (2008), labelled an assumption.

**Q: And sand mining?**
Honestly weak at 10 m. Rectangular-pit precision is 0.12, because paddies and ponds in the river corridor look the same. Sentinel-1 shows no monsoon activity on this reach (0 bright returns in the monsoon scene vs 6 in the dry scene). We show it as experimental. Doing it properly needs sub-metre imagery or a dense radar time series.

**Q: Isn't the Hasdeo mine legal?**
Possibly, in part. The lead is "forest became mine here between these dates". Checking it against the sanctioned lease and forest-clearance boundary (public on the Parivesh portal) is the department's step. The card says it needs verification and makes no legal claim.

**Q: What do you detect?**
Land-cover change only:
- new rectangular water-filled pits and disturbed sand bars inside the river corridor
- forest loss, with a "mine expansion" hint

Radar (Sentinel-1) corroborates, sees through monsoon cloud, and gives an aggregate activity index on the river during the monsoon ban months. ⏳ counts and precision.

**Q: How do you avoid flagging normal river changes?**
The river corridor comes from 38 years of JRC water history. Water-level and turbidity changes don't count. Only new rectangular pits and disturbed bars do. ⏳ audit precision.

**Q: Is this surveillance? Can it track people or vehicles?**
No. At 10 m, people and vehicles are invisible, and we report per-reach aggregates, never object tracks. Outputs go to authorised departments as leads that need ground verification. This follows the hackathon's protective-use rule.

**Q: Would this stand in court?**
We don't claim legal admissibility. Each evidence card is hash-chained (SHA-256 over canonical JSON plus image hashes). Changing one byte breaks verification, and the dashboard re-verifies in the browser. It's tamper-evident, with model version, thresholds, dates and cloud % recorded.

**Q: Who pays?**
State mines and geology departments (lost royalty and penalties) and forest departments (CAMPA net present value per hectare of diverted forest) ⏳ rates and sources.

---

## 8. Economics and business

**Q: Who pays, in one breath?**
- Cities and planners (A1)
- Renewable developers and state agencies (A2)
- Satellite operators: more value per contact minute (B)
- Mines and forest departments (C)

**Q: Are your rupee numbers real?**
They are sourced assumptions, each with a tooltip and source. We never present them as measured. Measured things: accuracy, latency, scheduler speed, value ratios.

**Q: Go-to-market?**
- Software licence for satellite operators (onboard + ground scheduler).
- Insight subscriptions per pack: city ledger, siting, enforcement evidence.
- Indian sovereign angle: an Indian-built pipeline and onboard AI on free Copernicus data today, portable to ISRO/NewSpace India satellites.

**Q: Cost to run?**
Free: open data, open weights, static hosting, runs on a laptop.

---

## 9. Edge cases (have one line ready for each)

| Case | What HERALD does |
|---|---|
| Cloud / cloud shadow | SCL mask; tiles under 85% clear are `invalid`, never "no change"; cloud head lowers value |
| Thin cirrus | known weak spot; training scenes added; flight would use B10 |
| Haze / smoke | indices are ratios; strong haze lowers the valid fraction; flagged by cloud head |
| Seasonal crops | same-season dates; `agri_ambiguous` category |
| Monsoon | optical blind → Sentinel-1 radar corroboration (Track C) |
| Lake drying vs filling | water history + what replaced the water; drying ignored |
| Government works (desilting, drains, roads) | `lake_works`, `drain_works`, `linear_infra`, not leads |
| Shoreline mixed pixels | minimum 0.2 ha connected patch |
| Small houses / extra floors | below resolution → tip-and-cue to sub-metre imagery |
| Geolocation error | change between dates reliable (~0.3 px); no property-line verdicts |
| Denotified lake | can't know without the registry → card says "check status" |
| No data in an area | tile invalid; scheduler gives zero value |
| Ground station down | windows recompute; scheduler is per-window and online |
| New urgent customer query | live reorder in under 60 ms |

---

## 10. Demo failure plan

| Failure | Fallback |
|---|---|
| Venue Wi-Fi down | everything is offline: `npm run preview` on the laptop |
| Public URL down | GitHub Pages mirror, then local preview |
| Globe slow on projector | Mission view works without terrain; skip to FIFO vs HERALD |
| Laptop dies | backup screen recording of the full demo on a phone/USB |
| Judge asks for a number not on screen | open `reports/*.json`; every UI number comes from there |

---

## 11. Our limits, stated first (say these before they ask)

- Replayed archived imagery on a compressed timeline, not live tasking.
- 10 m pixels: no floors, no small houses, no property lines.
- Weak labels (OSM, WorldCover ≈ 77%); audits are reviewer visual checks, not field visits.
- Economic parameters are assumptions with sources.
- One orbit, with constellation load modelled by ρ.
- Rule-based change; the embedding change score was tried and rejected (AUC 0.56).
- Scheduler is greedy against an upper bound, not proven optimal.
