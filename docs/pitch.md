# HERALD: 5-minute pitch script

For: the presenting team. Timed to 5:00. Dashboard open on the Mission tab, offline (`npm run preview`), backup recording ready.
Say every rupee figure as "an assumption, sourced". Numbers marked ⏳ get refreshed from the Gates panel before going on stage.

---

**0:00–0:25 · Hook** (screen: FIFO vs HERALD, ρ = 5, paused)
> "A satellite like Sentinel-2 sees about 10 minutes of ground station per pass and captures far more than it can send. Today it sends in the order it shot: clouds, empty fields, everything. HERALD is the satellite that sends home answers, not pictures."

**0:25–0:55 · Problem and payers** (screen: Economics tab)
> "Every byte competes. We priced the bytes with three real payers:
> - Bengaluru, where BBMP identified 472 acres of lake encroachment last year and reclaimed 17
> - renewable developers choosing land at a wafer-thin ₹2.6-per-unit auction tariff
> - forest departments watching mines advance into forest
>
> Every rupee on screen is a sourced assumption; every accuracy number is measured."

**0:55–1:50 · Track B live** (screen: Mission → FIFO vs HERALD → Queries)
1. Mission: "Real orbit model: 786 km sun-synchronous, 100.6-minute period, max pass 10.6 minutes, 5.5 GB."
2. FIFO vs HERALD: drag ρ from 1 to 5.
   > "HERALD delivers 98–99% of the best possible value at every bandwidth. FIFO falls to 15% when five satellites share the station. HERALD matches FIFO's whole five days in about one contact minute. First insight 43 minutes after capture instead of 35 hours. Full chips only, with no packet assumptions, wins by the same margin."
3. Queries: add a query live.
   > "A new customer request reorders 19,000 tiles in under 60 milliseconds."

**1:50–3:00 · Track A live** (screen: Insights, then Siting)
1. Insights: "Real Sentinel-2, north Bengaluru, Feb 2023 vs Feb 2025." Click the top lead: new layout, before/after slider.
   > "Road grids cut into farmland: the first sign of a layout, months before houses. Our engine found 535 hectares of new layouts. 69% of construction leads are real in our audit, 89% excluding unsure. It's a visual audit, not a field check, and the screen says so."
2. Point at the honesty panel.
   > "We flagged 10 lakes. None was confirmed as filling: they were dry-season drying and desilting. We report that instead of hiding it. At 10 metres we can't see floors; we tip and cue sub-metre imagery to the few sites that matter."
3. Ward table: "Growth outrunning roads, ward by ward, for planners."
4. Siting tab:
   > "Same satellite data, second objective: where Karnataka's next gigawatt goes. Ranked by cost per unit, including grid, road access and heat. The real Pavagada park ranks in our top 4% (median). Even our best cell costs ₹2.98 a unit against a ₹2.6 tariff, which is why location and scale decide who profits."

**3:00–3:50 · AI depth** (screen: Hardware, then About → Gates)
> "Onboard model: ResNet-18 pretrained on Sentinel-2, quantized to int8. 98.0% on EuroSAT, calibration error 0.0065, because the scheduler multiplies probabilities by rupees. Since EuroSAT is Europe, we added an India head trained on our own chips: 83% agreement with ESA WorldCover on held-out land. About ⏳ 1.1 ms per tile on a laptop CPU. The Gates panel shows every target, including the two we miss."

**3:50–4:30 · Track C** (screen: Evidence)
> "Hasdeo Arand: open-cast mines advancing into dense forest between 2023 and 2025. Mine-expansion leads are 88% real in our audit. Each card is hash-chained."

Click **Verify chain**: all green.
> "Change one byte and it breaks. Land cover only, never people. River sand mining at 10 m is honestly weak (12%), and we show it as experimental."

**4:30–5:00 · Close** (screen: FIFO vs HERALD curve)
> "Real data, free and offline, honest gates. Satellites already see the problem; HERALD decides what's worth sending home. Thank you."

---

## Rehearsal checklist
- [ ] Gates panel refreshed; ⏳ numbers spoken from it, not from memory
- [ ] Network off; dashboard still loads (offline proof)
- [ ] Each tab's click path practised 3×; total ≤ 5:00 ± 10 s
- [ ] Backup screen recording on a USB stick and a phone
- [ ] One person owns the clicks, one person talks
- [ ] Q&A: docs/judge_qa.md
