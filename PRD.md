# HERALD — PRD v3 (Unified: Track A + B + C in ONE system)

Aeromania '26 Mach-A-Thon · "Orbit to Economy: AI in Space" · 12 hours · solo build · 5-min pitch to Boeing judges

> One-liner: **HERALD is a satellite that decides what is worth sending home.** An onboard AI scores every image tile, a value-aware scheduler fills each real ground-station contact window with the highest ₹-value per byte, and the ground gets a tiny "insight packet" first, then a thumbnail, then the full chip only if someone pulls it. Two paying insight packs (urban construction verification, river sand-mining evidence) run on the same engine.

---

## 0. The ONE-project rule (non-negotiable)

There is exactly one pipeline, one repo, one dashboard, one demo:

```
Capture (real S2 archive replayed as orbit pass)
  → Onboard AI (cloud + class + change score, int8, <1 ms/chip)
  → Value model (₹ per tile, per customer query)
  → Scheduler (fills real contact windows by value/byte)
  → Progressive downlink (packet → thumb → full chip, pull-based)
  → Ground insight packs (A: construction, C: sand-mining/deforestation evidence)
  → Economics panel (who pays, how much)
```

| Track | What it is inside HERALD | Where judges see it |
|---|---|---|
| **A — Read the Planet** (compulsory) | Real Sentinel-2 L2A data → change detection → Pack A (construction growth/verification) with before/after slider, hectares, severity | Dashboard "Insights" view, live on real tiles |
| **B — Build the Orbit** | Orbit + contact windows + onboard AI + scheduler + link budget + FIFO vs HERALD + economics + physics sanity + hardware tab | Dashboard "Mission" + "FIFO vs HERALD" + "Hardware" views |
| **C — Guard the Nation** | Pack C: river sand-mining / deforestation evidence cards for state mining departments. Protective only: land-cover change, never people, vehicles, or targeting | Dashboard "Evidence" view, hash-chained cards |

Scoring map: Economic/strategic impact 30% (₹ panel, named payers), Technical depth & AI use 30% (onboard model, calibration, int8, scheduler UB), Feasibility 20% (real data, runs offline, honest limits), Demo & pitch 20% (side-by-side, live query reorder).

---

## 1. Problem and who pays

**Problem.** A LEO imaging satellite captures far more than it can downlink. Contact windows are minutes long. Today most systems downlink in capture order (FIFO) or with a simple cloud filter, so cloudy and empty tiles consume scarce bandwidth while valuable tiles wait days.

**Who pays and how much (all numbers are labelled assumptions, editable in the UI):**

| Payer | Pack | Illustrative sizing |
|---|---|---|
| Lenders / housing-finance cos., municipal planners | A: verify construction progress before releasing tranches | 5,000 sites × 4 checks/yr × ₹6,000 = ₹12 crore/yr; 60% replacing site visits = ₹7.2 crore |
| State mining / forest departments | C: evidence of illegal sand mining / clearing | 100 ha flagged/yr × ₹5 lakh per verified ha = ₹5 crore/yr |
| Satellite operator (the constellation owner) | Platform: fewer contact minutes to hit same value | Contact minutes saved × editable $/min (no vendor price claimed; AWS Ground Station publishes no per-minute figure) |

Anchors to cite (public): UNEP 2019 sand report, Bihar ~₹700 crore and Karnataka ~₹200 crore illegal-mining loss estimates (state them as reported, not ours), mining-alert systems being ignored roughly half the time due to lack of verifiable evidence.

Rule: every ₹ on screen has an "assumption" tooltip. Never present unmeasured numbers as measured.

---

## 2. Verified research findings (what the design rests on)

1. **Free real data, no account:** Earth Search STAC (Element84) serves Sentinel-2 L2A as Cloud-Optimized GeoTIFFs, anonymous. Windowed reads fetch only the AOI.
2. **Real cloud labels:** Sentinel-2 L2A includes SCL (scene classification). Classes 3 (cloud shadow), 8, 9 (cloud medium/high), 10 (thin cirrus) → cloud mask. No synthetic clouds.
3. **Land-cover context:** ESA WorldCover (CC-BY 4.0), ~77% global accuracy; v100 (2020) and v200 (2021) are not comparable for change → weak supervision only, never change ground truth.
4. **Weak validation labels:** OSM Overpass `landuse=construction` polygons for Pack A; sand-mining validated visually plus synthetic injected-change test.
5. **Clean headline accuracy:** EuroSAT (Sentinel-2, 10 classes). Literature 98.57–99.17% → our ≥97% target is realistic.
6. **Open pretrained weights:** SSL4EO-S12 ResNet-18 Sentinel-2 MoCo via torchgeo (weights CC-BY-4.0, code MIT), 13-channel input. We slice conv1 to the 5 bands used (B02, B03, B04, B08, B11 = indices [1,2,3,7,11]). Fallback: timm MobileNetV3/ResNet-18 ImageNet, then from scratch.
7. **Prior art (cite, do not overclaim):** CloudScout / Phi-Sat-1 did onboard cloud filtering (~92% accuracy, ~1% FP). CEGA/Berkeley detected sand mining on Gangetic rivers with 10 m Sentinel-2 + ML. Our novelty is the **query-driven, value-per-byte, progressive-pull downlink scheduler** with calibrated onboard scores and an honest economics layer, not "onboard AI exists" and not radiation-hardening (RECON/RedNet exist).
8. **Hosting:** Vercel Hobby is free but non-commercial only, 100 GB bandwidth/month, over-limit waits up to 30 days. Hackathon demo is fine; keep GitHub Pages and local `npm run preview` as fallbacks.

---

## 3. Goals and measurable targets (with gates)

| ID | Metric | Target | Gate (must pass to keep claim) |
|---|---|---|---|
| G1 | EuroSAT top-1 (test split) | ≥ 97% | Measured on held-out split, report in `reports/model.json` |
| G2 | Cloud-fraction MAE vs SCL | ≤ 0.05 | Real SCL, held-out AOI |
| G3 | Calibration ECE | < 0.03 | After temperature scaling |
| G4 | Model latency (int8 ONNX, CPU, batch 64) | < 1 ms/chip amortized | Benchmarked on this laptop |
| G5 | Scheduler | < 10 ms per 1,000 tiles | Python and TS both |
| G6 | Live query add + reorder | < 100 ms | Measured in browser worker |
| G7 | Dashboard | 60 fps, < 1.5 s load | Chrome perf trace |
| G8 | HERALD vs FIFO value captured | ≥ 2× at ρ=5 | Simulation report |
| G9 | Capacity-to-90%-value | report contact minutes saved vs FIFO | Simulation report |
| G10 | Change detection vs OSM construction | report precision/recall honestly | Weak labels, caveated |
| G11 | Injected-change test | recall ≥ 0.9 at ≥ 1 ha | Synthetic, deterministic |

Latency framing: software latency (capture→decision→schedule) is near-zero and measured; delivery latency is orbit-controlled (contact windows) and **minimized by scheduling**, not eliminated. Say this out loud; judges respect it.

---

## 4. Architecture

### 4.1 Decisions (ADRs)

| ADR | Decision | Why | Rejected |
|---|---|---|---|
| 1 | Replay archived S2 as if captured | Real data, free, deterministic, offline | Live tasking (impossible) |
| 2 | One engine, two packs | A and C share change detection; minimal extra scope | Separate projects |
| 3 | Python pipeline, TS scheduler port + parity test | Python for science, TS for instant in-browser reorder | Server round trips (latency, hosting) |
| 4 | Static site + precomputed artifacts | Free forever, no backend, Vercel/GitHub Pages | Hosted API (quota, cost) |
| 5 | Open SSL4EO weights, fine-tune lightly | Domain-matched, faster, higher accuracy | Scratch training (slower, lower) |
| 6 | Calibrated scores, not raw softmax | Value model needs trustworthy probabilities | Uncalibrated argmax |
| 7 | UB = fractional-knapsack relaxation | Honest upper bound, cheap | Claiming exact optimum |
| 8 | Python CLI not Makefile | Windows + Linux parity | Makefile/bash |
| 9 | Data vault with SHA-256 MANIFEST | Everything runs offline after one build | Live fetch in demo |

### 4.2 Components

```
python/herald/
  orbit.py        DONE  synthetic SSO / TLE, ground track, contact windows
  vault.py        STAC fetch, COG windowed read, chip tiling, MANIFEST, verify, pack
  labels.py       SCL cloud labels, WorldCover composition, OSM construction
  model.py        SSL4EO ResNet-18 → multi-task heads, calibration, int8 ONNX export
  change.py       indices (NDVI/NDBI/MNDWI/BSI) + pixel rules → severity, hectares
  value.py        tile value (₹), query matching, progressive level sizes
  sched.py        policies B1,B2,B3,H1,H2 + UB + metrics
  sim.py          orbit capture timeline → tiles → scheduler → results.json
  evidence.py     hash-chained evidence cards (Pack C and A)
  bench.py        latency/accuracy report generator
  cli.py          `python -m herald <cmd>`
web/             React + Vite + TS + CesiumJS dashboard (static)
web/src/sched.ts TypeScript port of sched.py, parity-tested
hw/              Pi scorer + ESP32 gated ground station + bridge (stretch)
```

### 4.3 Data flow and contracts

- `vault/` (gitignored large, committed small): chips as `uint16` arrays `[N,5,64,64]`, `meta.json` (tile id, lat/lon, date, MGRS tile, relative orbit), `labels.npz`, `MANIFEST.json` (sha256 per file).
- Chip: 64×64×5 bands×2 B = **40,960 B** raw, 40.96 ha at 10 m.
- Progressive levels: **packet ≈ 200–256 B** (class, cloud, change score, severity, bbox, hash) → **thumbnail ≈ 2.4 KB** (JPEG/quantized RGB) → **full chip 40 KB**. Ratios full:thumb ≈ 17×, full:packet ≈ 205×.
- Outputs to web: `public/data/{track,windows,tiles,results,evidence,economics,model_report}.json`. Dashboard is purely static consumption.

---

## 5. Real data plan

- **AOIs (3, 30×30 km each → 2,116 chips per AOI):**
  1. Bengaluru periphery (urban/construction growth, Pack A).
  2. A Gangetic or Sone river stretch in Bihar (sand mining, Pack C).
  3. A forest-edge AOI (Western Ghats or Central India) for deforestation/clearing (Pack C) and diverse land cover.
- **Dates:** two same-season anniversary dates per AOI (e.g. Jan 2024 vs Jan 2025) to kill seasonal confounding. Same MGRS tile and relative orbit. Cloud-gated: reject scene pair if combined SCL cloud > 30% inside AOI.
- Total chips: 3 AOIs × 2 dates × 2,116 = **12,696**, ≈ **532 MB** raw (fits laptop; vault packs to a zip).
- **Reflectance:** apply L2A scale/offset (÷10000, handle `BOA_ADD_OFFSET` for post-2022-processing-baseline scenes) before indices. Note honestly that onboard systems would use TOA.
- **Selection script** picks scenes by `eo:cloud_cover`, date, tile; stores STAC item IDs in `vault/scenes.json` so the build is reproducible.

---

## 6. Onboard AI model

- Backbone: SSL4EO-S12 ResNet-18 (torchgeo), conv1 sliced to 5 bands.
- Heads (multi-task, shared trunk): EuroSAT 10-class, SCL cloud fraction (regression), WorldCover composition (soft, weak), 64-d embedding (for query similarity).
- Training: freeze trunk 1 epoch, unfreeze last block, AdamW, label smoothing, light aug (flip/rot90). RTX 2050 4 GB: batch 128, AMP, `num_workers=0` on Windows. Target < 25 min.
- Calibration: temperature scaling on validation; report ECE before/after.
- Export: ONNX → int8 static quantization (ORT) with calibration set of real chips; verify accuracy drop ≤ 0.5 pt and report.
- Fallback ladder: SSL4EO → timm MobileNetV3 → scratch small CNN. Decision made at Gate M3 by measured accuracy, not preference.
- Latency check: batch 64 CPU ORT, report ms/chip; Pi measurement in hardware tab.

---

## 7. Change engine (shared by Pack A and Pack C)

- Per chip pair (t0, t1), cloud-gated (both clear ≥ 85% pixels by SCL).
- Indices: NDVI, NDBI, MNDWI, BSI. Rules:
  - **Construction (A):** vegetation/bare soil → built-up/bare: ΔNDBI↑, ΔNDVI↓, BSI↑, not water.
  - **Sand mining (C):** river-bar/bank bare-sand and water-mask changes along the channel: ΔBSI↑, MNDWI shape change inside the river buffer.
  - **Clearing (C):** ΔNDVI strongly ↓ inside forest class at t0.
- `severity = changed_px / 4096`; `ha = severity × 40.96`.
- Thresholds set once on a validation AOI, frozen, then tested on others (no tuning on test).
- Validation: (1) OSM construction overlap → precision/recall with stated weak-label caveat, (2) synthetic injected-change test (paint known patches into t1; recall by patch size), (3) visual QA grid saved to `reports/qa/`.
- Honest scope: indices-and-rules, not a deep change model. Cite as a transparent, auditable baseline.

---

## 8. Value model and economics

- `value(tile, query) = P(relevant | model, calibrated) × area_ha × ₹_per_ha(pack) × freshness × (1 − cloud_penalty)`.
- Queries: pack + region + min severity + priority multiplier. Live add/remove/reorder in UI.
- Progressive sizes and incremental value: packet captures ~70% of decision value for ~0.5% of bytes (this is a modeled parameter, shown editable; do not claim measured).
- Contact-minute savings: `minutes_FIFO_to_90% − minutes_HERALD_to_90%` × editable $/min.

---

## 9. Orbit, capture, link model

- Orbit: Sentinel-2-like SSO, 786 km, 98.62°, 10:30 LTDN, swath 290 km. Real TLEs via CelesTrak optional; synthetic default (offline).
- Stations: Bengaluru, Svalbard, Kiruna, Fairbanks, Hartebeesthoek, Punta Arenas (`stations.json`).
- Contact windows via Skyfield, min elevation 10°. Physics sanity: half-angle ≈ 18.76°, period ≈ 100.43 min, **max pass ≈ 10.47 min**, at 100 Mbps × 0.7 efficiency ≈ **5.51 GB per max pass**.
- Bottleneck realism: our AOI archive is only ~532 MB, so we scale window capacity by oversubscription ρ ∈ {1, 2, 5, 10} (capacity ÷ ρ). ρ=2 → 266 MB, ρ=5 → 106 MB, ρ=10 → 53 MB. State clearly this models a fleet of satellites competing for the same windows.

---

## 10. Scheduler

Policies: **B1** FIFO · **B2** cloud-filter + FIFO (CloudScout-style, drop > 70% cloud) · **B3** value-only greedy · **H1** value/byte greedy · **H2** progressive (packets first for all, then thumbnails, then pulls by marginal value/byte).
Upper bound: fractional-knapsack relaxation (labelled "upper bound", not optimum).
Metrics: value captured (₹), % of upper bound, contact minutes to 90% target, time-to-first-insight, bytes wasted on cloud.
Implementation: Python reference (sort by ratio, O(n log n)) + TypeScript port; `tests/test_parity.py` runs identical inputs through both via fixture JSON and asserts equal selections. Browser runs scheduler in a Web Worker.

---

## 11. Dashboard (React + Vite + TS + CesiumJS)

Views (tabs):
1. **Mission:** globe with ground track, contact windows, live pass countdown, bytes per window.
2. **FIFO vs HERALD:** side-by-side timelines, cumulative value curves, ρ slider, UB line, contact-minutes-saved card.
3. **Insights:** AOI tiles (point primitives, ~13k points), click → before/after slider, severity, ha, confidence, "pull full chip" progressive upgrade animation.
4. **Queries:** add/remove/reorder customer queries live; schedule recomputes < 100 ms.
5. **Evidence (Pack C):** evidence cards with SHA-256 chain, verify button.
6. **Economics:** who pays, editable assumptions, ₹ totals.
7. **Hardware:** Pi/ESP32 benchmark and optional live link.
8. **About/Limits:** honest limitations list.

Cesium: bundled NaturalEarthII imagery, **no Cesium ion token**, no live tiles. Performance budget: point primitives not entities, workers for scheduling, lazy-load chip images, 60 fps gate.

---

## 12. Protective-use and ethics statement (Track C)

- Detects **land-cover change only** (bare sand, water-mask change, vegetation loss) at 10 m. Cannot see people or vehicles and is not used to track individuals.
- No weapons, targeting, or surveillance of persons. Outputs go to authorized departments as **evidence leads that require ground verification**.
- Evidence cards state model version, thresholds, dates, cloud %, and confidence; hash-chained for tamper evidence, not legal admissibility.

---

## 13. Cross-platform (Windows + Linux) rules

- CLI: `python -m herald <cmd>` (no Makefile, no shell scripts). Commands: `vault build|verify|pack`, `train`, `export`, `sim`, `bench`, `evidence`, `all`.
- `pathlib` everywhere, `encoding="utf-8"`, no `shell=True`, lowercase filenames, `.gitattributes` `* text=auto eol=lf`.
- DataLoader `num_workers=0` on `win32`, `if __name__ == "__main__":` guards.
- `rasterio.Env` configured in code (`AWS_NO_SIGN_REQUEST=YES`), not env files.
- `--device auto` (cuda → cpu). CPU path must work for teammates.
- Commit small artifacts (int8 model, scores, results JSON) so Windows teammates run the dashboard without training.
- Node 20+, `npm ci`; no OS-specific scripts in package.json.

---

## 14. Free-forever matrix

| Need | Choice | Cost | Limit risk |
|---|---|---|---|
| Imagery | Earth Search STAC + S2 COGs | free, no key | none; cached in vault |
| Labels | SCL, WorldCover, OSM Overpass | free | cached once |
| Weights | SSL4EO-S12 via torchgeo | free | local file |
| Orbit | Skyfield + synthetic TLE | free | offline |
| Globe | CesiumJS + bundled NaturalEarthII | free | no ion |
| Hosting | Vercel Hobby (static) | free | non-commercial, 100 GB/mo; fallbacks: GitHub Pages, `npm run preview` |
| Compute | this laptop | free | none |

No API keys, no trials, no Colab dependence, no live tile servers. After `vault build` the full demo runs with the network off.

---

## 15. Build plan — modules, phases, acceptance (12 h)

Time is T+hours from kickoff. **Demo freeze at T+10.5. Rehearsal T+10.5–12.**

| Module | T+ | Deliverable | Acceptance | Cut priority |
|---|---|---|---|---|
| **M0 Skeleton** | 0:00–0:30 | repo, CLI, CI-less test runner, `orbit.py` (done) wired into CLI | `python -m herald orbit` writes windows.json on Win+Linux | must |
| **M1 Vault** | 0:30–1:45 | STAC select, COG windowed reads, chips, MANIFEST, verify/pack | 12,696 chips, `vault verify` passes, offline reload | must |
| **M2 Labels** | 1:45–2:30 | SCL cloud labels, WorldCover, OSM construction | label arrays aligned to chips; sanity plots | must |
| **M3 Model** | 2:30–4:15 | fine-tune, calibrate, int8 ONNX (GPU job runs in background while M4/M5 are written) | G1–G4 measured and written to `model_report.json` | must |
| **M4 Change** | 2:30–4:00 (parallel) | change engine + validation + injected test | G10, G11 reports; QA grid | must (A) |
| **M5 Value+Sched** | 4:00–5:15 | value model, 5 policies, UB, metrics, parity fixture | G5, G8, G9; Py tests pass | must |
| **M6 Sim** | 5:15–6:00 | orbit→capture→tiles→schedule→results.json for ρ sweep | all JSONs generated by one `all` command | must |
| **M7 Dashboard** | 6:00–8:30 | views 1–4 + TS scheduler + worker + parity test | G6, G7; live reorder demo works | must |
| **M8 Packs/Evidence** | 8:30–9:30 | Pack C cards, hash chain, verify UI, economics view | evidence verifies; ₹ panel with assumptions | must (C minimal), nice (full) |
| **M9 Deploy** | 9:30–10:00 | Vercel static deploy, GitHub Pages fallback, offline preview | public URL loads < 1.5 s | must |
| **M10 Hardware** | parallel stretch, only if M0–M9 on time | Pi scores chips with int8 ONNX; ESP32 gated link; `--simulate` fallback | hardware tab shows measured ms/chip | cut first |
| **M11 Pitch** | 10:30–12:00 | slides/script, 3 full rehearsals, backup recording | 5:00 timing ±10 s | must |

**Cut order if behind:** M10 hardware live link → full Pack C polish (keep one evidence card) → third AOI (keep 2) → scheduler H2 refinement (keep H1) → TS parity extras. Never cut: real data, onboard model numbers, FIFO vs HERALD, economics, honest limits.

**Gates:** M3 gate at T+4:30 (if accuracy < 95% switch fallback ladder immediately). M7 gate at T+8:30 (if dashboard unstable, ship Mission + FIFO vs HERALD + Insights only).

---

## 16. Testing

- `pytest`: orbit (done), vault MANIFEST round-trip, label alignment, change on synthetic patches, scheduler invariants (never exceeds capacity, monotone value, UB ≥ any policy), Py↔TS parity.
- `vitest`: scheduler port, evidence-chain verify.
- Smoke: `python -m herald all --quick` completes in < 5 min on 1 AOI; dashboard builds with `npm run build`.
- Manual: Chrome perf trace for 60 fps; offline run with network disabled.

---

## 17. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| STAC/COG download slow | M1 overruns | Start vault build first, small windows, resume-safe, 2 AOIs minimum |
| SSL4EO weights fail to load | M3 delay | Fallback ladder; decision at gate |
| Cloudy scene pairs | no valid change pairs | Cloud-gated selection with many candidates, widen date window |
| Weak labels look bad | credibility | Present as weak validation + synthetic test + visual QA; never overclaim |
| 4 GB VRAM OOM | training crash | batch 64, AMP, freeze trunk, CPU fallback |
| Cesium perf | < 60 fps | point primitives, culling, drop entities |
| Vercel quota | demo outage | GitHub Pages + local preview + recorded video |
| Windows path/encoding bugs | team blocked | CLI rules in §13, CI-less quick test on both |

---

## 18. Five-minute pitch and demo script

**0:00–0:30 Hook.** "Satellites capture 100× more than they can send home. HERALD decides what's worth sending." Show FIFO vs HERALD frozen frame.
**0:30–1:15 Problem + payer.** Who pays: lenders, mining departments, operators. ₹ numbers with "assumption" label.
**1:15–2:30 Live demo (Track A+B).** Mission globe → contact window → side-by-side race. Move ρ slider. Add a live query; schedule reorders in < 100 ms. Click a tile: packet → thumbnail → pull full chip; before/after slider shows construction in Bengaluru.
**2:30–3:30 AI depth.** Onboard int8 model: accuracy, ECE, ms/chip (measured on this laptop). Calibrated scores drive value. UB line.
**3:30–4:15 Track C.** Sand-mining evidence card, hash chain verify. "Land cover only, never people."
**4:15–4:45 Economics + physics.** Contact minutes saved, 5.5 GB per max pass sanity check.
**4:45–5:00 Limits + close.** Simulated replay of real archived imagery, weak labels, one orbit. "Honest numbers, real data, runs free."

**Q&A prep:** Why not just cloud-filter? (CloudScout is B2; we beat it on value/byte; numbers on screen.) Is this novel? (Onboard AI isn't; query-driven progressive value scheduling with calibrated scores and honest economics is.) Accuracy? (EuroSAT held-out; change is weak-label validated.) Why ρ? (Models many satellites sharing windows.) Real hardware? (Pi measured, ESP32 gated link, if built.) Privacy/ethics? (§12.)

---

## 19. Honest limitations (shown in the UI)

Simulated replay of archived imagery as if captured · weak labels (WorldCover ~77%, OSM incomplete) · one orbit, one constellation size via ρ · economic parameters are assumptions · L2A used where flight would use TOA · change engine is rule-based · upper bound is a relaxation, not an optimum.

---

## 20. Claude Code instructions

Build in module order M0→M11. After each module: run its tests, update the README checklist, commit. Do not start a module until the previous acceptance passes. Never add network calls to the demo path. Never hard-code a number into the UI that is not read from a generated report.

### CLAUDE.md (drop in repo root)

```
# HERALD
One project, three tracks: A real-data change insights, B onboard AI + orbit + value scheduler + economics, C protective evidence pack (land-cover only, never people).
Rules: Python 3.11, CLI `python -m herald <cmd>`, pathlib only, utf-8, no shell=True, lowercase filenames, LF endings. Windows+Linux must both work. Demo path is offline (vault). All UI numbers come from reports/*.json. Label assumptions. No Cesium ion, no API keys.
Order: M0 skeleton → M1 vault → M2 labels → M3 model → M4 change → M5 sched → M6 sim → M7 web → M8 packs → M9 deploy → M10 hw (optional) → M11 pitch.
Tests: pytest (python/tests), vitest (web). Parity test Py↔TS scheduler must pass.
```

---

## 21. Sources to cite on the final slide

ESA Sentinel-2 L2A / SCL · Element84 Earth Search STAC · ESA WorldCover (CC-BY 4.0) · SSL4EO-S12 (Wang et al.) via torchgeo · EuroSAT (Helber et al.) · CloudScout / Phi-Sat-1 (Giuffrida et al.) · CEGA/Berkeley sand-mining detection · UNEP 2019 "Sand and sustainability" · OpenStreetMap contributors (ODbL) · CelesTrak · Skyfield.
