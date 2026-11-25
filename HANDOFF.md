# HANDOFF — HERALD (FINAL STATE, 2026-11-26 ~02:40)

**Live:** https://herald-dusky.vercel.app (Vercel prod, static) · **Repo:** github.com/PRATHVI9607/Aeromania (main) · **Offline demo:** `cd web && npm ci && npm run build && npm run preview`
**Pitch:** docs/pitch.md · **Judge Q&A:** docs/judge_qa.md · **Spec + gates:** PRD.md ("Headlines (v5)", "Targets v5") · **Run:** README.md

## Final status
| Area | State | Headline numbers (all from reports/*.json) |
|---|---|---|
| A1 Bengaluru construction ledger | done | 488 construction leads; reviewer-audit precision 0.89 excl. unsure (0.69 incl.); injected recall 0.95 @1 ha; 10 lake leads, 0 confirmed filling (honest); ward + growth-vs-roads tables |
| A2 renewable siting (Pavagada) | done | LCOE ranking; real park cells median 96th percentile; best cell ₹2.98/kWh vs ₹2.6 tariff; A1-A2 PV check inconclusive (stated) |
| B orbit + scheduler | done | % of upper bound ρ=1/2/5: HERALD 99.3/99.0/98.4 vs FIFO 53.5/15.2/1.2 vs cloud filter 69.6/33.1/6.1; match FIFO in 2.85 min; first insight 1.8 min (same-pass downlink) |
| C mining into forest + evidence | done | Hasdeo mine expansion audit precision 0.88, S1 VH −3.5…−7.5 dB corroboration; 14 hash-chained cards verify (Python + browser); sand pits 0.12 → labelled experimental |
| Onboard model | done | EuroSAT int8 98.02% (fp32 98.11), ECE 0.0065, India WorldCover head 83.1%; cloud MAE 0.205 (miss, no B10 band); int8 CPU 0.88–1.17 ms/chip (borderline) |
| Web | done | 9 views, 3D mission + 3D ledger, race animation, error boundaries (WebGL failure never blanks the app), licence footer |
| Quality gate | pass | ruff clean; pytest 42/42 with -W error, 0 skips; vitest 26/26; tsc clean; pipeline reproducible; 0 console errors, 0 external requests, 0 404 on the live site |

## Before going on stage
1. Open the dashboard in Chrome on the demo laptop; confirm the 3D globe is smooth (GPU fps could not be measured headless).
2. Prefer `npm run preview` on the laptop; the Vercel URL is the backup. Open each tab once so assets are cached.
3. Speak numbers from the Gates panel (About / Limits), not from memory.

## Gates still not met (shown honestly in the UI)
- G2 cloud MAE 0.205 vs 0.05 — 5-band input lacks the cirrus band (B10).
- G4 int8 latency 0.88–1.17 ms vs < 1 ms — borderline, laptop thermals.

---

# HANDOFF — HERALD live build state

Read this + CLAUDE.md before touching code. Do NOT re-read PRD.md end to end; the sections you need are cited by number.
When you finish a module: update **Status** row, add 1–3 lines under **Notes from builders**, commit (no AI attribution trailer).

Clock: live 12 h hackathon build, started 2026-11-25 ~21:40 local. Priority: Track A → B → C. Cut order: PRD §15.

## Status

| Module | Owner | State | Key outputs |
|---|---|---|---|
| M0 skeleton | lead | done | pyproject (uv, py3.11, torch cu126), cli.py, paths.py, config/aois.json |
| M1 vault + M2 labels (+S1) | builder-data | done | vault/*, reports/vault.json, reports/qa/labels_*.png (25,392 chips, verify OK) |
| M3 model | builder-model | done (G2 cloud MAE and G4 latency miss gates, see notes) | models/herald_int8.onnx, reports/model.json |
| M4 change | builder-change | done (blr, sone, hasdeo run on real data) | reports/change_{aoi}.json, survey_blr.json, sites_blr.json, qa/, web/public/data/img/* |
| M5 value+sched, M6 sim, orbit | builder-orbit | done (synthetic data; real run pending vault) | windows/track/results/tiles/queries.json, reports/sim.json, sched_parity.json |
| M7 web | builder-web | done (v1; Evidence/Economics/Hardware placeholders) | web/ (Vite+React+TS+Cesium) |
| Siting (Track A obj 2) | builder-siting | done | reports/siting.json, web/public/data/siting.json, img/siting_{solar,wind}.png, config/siting.json |
| M8 evidence (Track C) | builder-trackc | done (evidence + audit; economics.json still later) | reports/evidence.json, web/public/data/evidence.json, img/ev_*.jpg, reports/audit_trackc.json |
| M9 deploy, M10 hw-sim, M11 pitch script | — | later | |

## Environment
- `uv sync` then `uv run python -m herald <cmd>`; tests `uv run pytest -q`.
- GPU: RTX 2050 4 GB (CUDA ok). CPU path must also work (`--device auto`).
- Network allowed only in vault/labels build. Earth Search STAC: `https://earth-search.aws.element84.com/v1`, collection `sentinel-2-l2a` (anonymous; set `AWS_NO_SIGN_REQUEST=YES` via `rasterio.Env`). S1: Planetary Computer STAC `https://planetarycomputer.microsoft.com/api/stac/v1`, collection `sentinel-1-rtc`, sign with `planetary_computer.sign` (anonymous).

## AOIs (config/aois.json)
`blr` Bengaluru north (Pack A, construction) · `sone` Sone river at Koilwar, Bihar (Pack C, sand mining) · `hasdeo` Hasdeo Arand, Chhattisgarh (Pack C, forest clearing).
Each AOI = 30 km × 30 km UTM square = 3000×3000 px at 10 m = 46×46 = **2116 chips** (64×64; drop the 56 px remainder at right/bottom edge — record exact origin).

Dates per AOI (all same MGRS tile + same relative orbit):
- `t0`, `t1`: clear anniversary pair, dry season, years per aois.json (2023 vs 2025; fall back to 2024 vs 2025 if no clear pair). Gate: AOI SCL cloud ≤ 30% each, prefer ≤ 5%.
- `c1`, `c2`: two extra real captures between t0 and t1 or after t1 with **meaningful cloud (15–70% in AOI)**. Needed for the cloud head training and for the sim (FIFO wastes bytes on these).
→ 3 AOIs × 4 dates × 2116 = 25,392 chips ≈ 1.04 GB raw.

## Data contracts (do not change without updating this file)

### Vault (`python/herald/paths.py` constants)
- `vault/scenes.json`: `{aoi: {epsg, origin_xy:[x0,y0], mgrs, rel_orbit, dates: {t0|t1|c1|c2: {item_id, datetime, aoi_cloud_scl, boa_offset_applied: bool}}, s1: {label: {item_id, datetime}}}}`
- `vault/chips/{aoi}_{date}.npy`: uint16 `[2116,5,64,64]`, bands B02,B03,B04,B08,B11 (B11 bilinear 20→10 m). **Harmonized: BOA offset already applied, value = reflectance×10000, clipped ≥0.** Downstream: `refl = x / 10000`.
- `vault/chips/{aoi}_{date}_scl.npy`: uint8 `[2116,64,64]` SCL (nearest 20→10 m).
- `vault/meta/{aoi}.json`: `{aoi, epsg, origin_xy, grid: [46,46], tiles: [{i, row, col, lat, lon, bbox:[w,s,e,n]}]}` (tile i = row*46+col, lat/lon = chip center WGS84).
- `vault/labels/{aoi}.npz`: `cloud_{date}` float32 [2116] (SCL classes 3,8,9,10 fraction), `nodata_{date}` (SCL 0 fraction), `wc` float32 [2116,11] WorldCover 2021 class fractions (classes 10,20,…,100,95 order as in WorldCover legend), `osm_constr` float32 [2116] fraction of chip in OSM landuse=construction (blr only, zeros elsewhere), `osm_constr_mask_{date}` optional.
- `vault/s1/{aoi}_{label}.npy`: float16 `[2116,2,64,64]` VV,VH in dB on the same 10 m grid (sone required, hasdeo optional). Labels: `t0`, `t1`, `monsoon` (one Jul–Sep acquisition between t0 and t1).
- `vault/MANIFEST.json`: `{relpath: sha256}` for every vault file; `vault verify` recomputes.

### Model (M3)
- `models/herald_int8.onnx` (+ `models/herald_fp32.onnx`). Input `x` float32 `[B,5,64,64]` = `(refl - mean)/std` with mean/std in `models/norm.json`. Outputs: `logits` [B,10] EuroSAT (apply temperature from `reports/model.json`), `cloud` [B,1] fraction 0..1, `emb` [B,64] L2-normalized.
- `reports/model.json`: `{backbone, eurosat:{top1_fp32, top1_int8, ece_before, ece_after, temperature, n_test}, cloud:{mae, heldout_aoi}, latency:{ms_per_chip_int8_cpu_b64, device}, classes:[...]}` — real measured numbers only.
- `vault/scores/{aoi}_{date}.npz`: `probs` [2116,10] calibrated, `cloud` [2116], `emb` [2116,64] float16, `wc` [2116,11] float32, `echg` [2116] (c1,t1,c2 only, from `score --change`; re-run it after every `score`).
- EuroSAT class order (torchgeo): AnnualCrop, Forest, HerbaceousVegetation, Highway, Industrial, Pasture, PermanentCrop, Residential, River, SeaLake.
- Known domain gap: EuroSAT is L1C/TOA, vault is L2A/BOA. Report it; do not hide it.

### Change (M4) — PRD §7
- `reports/change_{aoi}.json`: per tile `{i, kind, sev, ha, valid, dndvi, dndbi, dmndwi, dbsi, s1_dvv?, s1_dvh?}` for t0→t1 + summary + validation `{osm:{precision,recall,caveat}, injected:{recall_by_size}}`.
- `web/public/data/img/{aoi}_{date}.jpg`: true-colour mosaic (B04,B03,B02), one shared 2–98% stretch per AOI so dates compare. t0/t1 at 1500 px (2 px per... 0.5 scale), c1/c2 at 750 px. UI crops tiles with CSS.

### Value + scheduler (M5/M6) — PRD §8–10
- Byte sizes per tile capture: `packet` 256 B, `thumb` 2,400 B, `full` = `len(zlib.compress(chip_bytes, 6))` (measured per chip; label "zlib proxy for CCSDS-122").
- Level value fractions (modeled assumption, editable): packet 0.70, thumb 0.85, full 1.00.
- `value(tile, query) = p_rel × ha × rupees_per_ha[pack] × (1 − cloud) × priority`, realized at downlink time × `0.5 ** ((t_down − t_cap)/half_life_h)`. Tile value = sum over matching queries. Params in `config/value.json`.
- Policies B1 FIFO, B2 cloud>0.7 drop + FIFO, B3 value-desc full chips, H1 value/byte full chips, H2 progressive marginal value/byte with pull threshold. UB = fractional knapsack, no decay, total capacity.
- Capacity: sum over windows = archive_bytes / ρ, distributed ∝ window duration; ρ ∈ {1,2,5,10}.
- `web/public/data/tiles.json`: compact columnar `{fields:[...], rows:[[...]]}` with id, aoi, date, t_cap_min, lat, lon, cls, conf, cloud, kind, sev, ha, pA, pC, full_bytes.
- `web/public/data/{track,windows,results,queries}.json`; parity fixture `python/tests/fixtures/sched_parity.json`.

### Web (M7) — PRD §11
- Static only. Reads `web/public/data/*.json` + `models/` report copies. Every ₹ number has an "assumption" tooltip.

## Lead decisions (latest first)
- REVIEW 01:10 (Opus): Track B value was 93.6% from a seasonal false positive (hasdeo c1 Jun 2023 leaf-off = 3,986 ha fake clearing). Fix: capture change confirmed only where the seasonally matched t0->t1 pair changed (sev_c = min(sev_c, sev_t1)). ALL Track B numbers in this file and docs are STALE until the sim re-runs; quote only reports/sim.json. Same-pass downlink (split windows at capture time) added for G13. Track B framing = % of upper bound, never ratios.
- v5 HEADLINES + TARGETS: PRD 'Headlines (v5)' and 'Targets v5' table are the source of truth for pitch/UI wording and gates (G1 >=98.0% int8, G3 <0.01, G5 <5 ms, G6 <60 ms, G8 >=2x@rho2 & >=10x@rho5, G9 <=5 min, G11 >=0.9@0.5 ha, new G12-G17). Web: show product line 'HERALD — the satellite that sends home answers, not pictures.' and a Gates panel (About) rendering pass/fail from reports JSON, never hard-coded.
- TRACK B PITCH FRAMING (lead-approved): never quote one ratio alone. Show the curve vs rho (1.55x at rho=1, 8.6x at 2, 27.7x at 5, 57.8x at 10) + why (26% of tiles carry value; most waste is no-change tiles, not cloud; B2 cloud filter still 20x behind at rho=5) + 'HERALD matches FIFO's 5-day value in ~2 contact minutes' + first insight 25.4 vs 81.7 min (rho=5) + H1 full-chips robustness.
- ORDER (user): finish Track A fully (ledger v2, lakes edge cases, siting, Insights + Siting web views, review) -> then B (sim rerun, FIFO vs HERALD view) -> then C.
- Track A objective 2 = renewable siting (builder-siting): siting.py, reports/siting.json, web/public/data/siting.json.
- Embedding change (echg) REJECTED for pitch: AUC 0.56 vs rules, 0.51-0.63 on injected patches. Kept in model.json as an honest negative result. Onboard change = stored t0 index maps at 20 m (~3 KB/tile) + same rules. Backlog stretch: tiny siamese change CNN, only if A/B/C done.
- CONTRACT ADD: reports/change_{aoi}.json gets `captures: {c1,t1,c2: [tile records]}` (each capture vs t0, same rules + validity gate); `tiles` stays = t1. Sim uses captures when present. Reason: real-data sim showed 37x H2/B1 at rho=5 driven by valueless c1/c2 tiles; not credible.
- TRACK A HEADLINE v4.1 (supersedes encroachment-only): construction ledger with categories new_layout / building_construction / lake_filling_lead / agri_ambiguous; tank-bed seasonal false positives excluded; stalled/active statuses dropped (dates do not support them); Boeing anchor dropped. Web Insights leads with the ranked lead list + category legend + audit precision.
- 2026-11-25 TRACK A HEADLINE (final): "Catch the encroachment before the flood." Outputs: lake-buffer flags (KTCDA 2025 tiers), near_drain (50 m, OSM), site ledger with stage over 4 dates + `intervene_window`, ranked enforcement list `reports/sites_blr.json`; tax-roll survey + growth are secondary. Web Insights must lead with the enforcement list.
- 2026-11-25 Track A re-grounded by research: payer = city revenue dept (BBMP/GBA property-tax survey triage) + planners. `config/value.json` rupees_per_ha.A = 84000 (sourced assumption), query `q_gba` replaces `q_lender`. Change engine adds cleared/built stages, BBMP ward aggregation (`config/ref/bbmp_wards.geojson`), `reports/survey_blr.json`, anchor-site check (Boeing BIETC campus, Devanahalli). PRD v4 §0, §1, §7, §22.
- Pending for builder-orbit (on real-data rerun): G9 headline = contact minutes for H2/H1 to reach FIFO's final value; verify real-input path reads `reports/change_{aoi}.json`.
- Pending for builder-web: Insights gets growth summary + ward survey list (from `reports/survey_blr.json`) + payer card; Economics view reads sources from `config/value.json`.
- G5 timing test fails under load (12.8 ms with training + downloads running, 4.99 ms idle). Recheck when idle before claiming.

## Notes from builders
- (lead) PRD says orbit.py "DONE" but it was not in the folder; builder-orbit writes it.
- (builder-web) Run: `cd web && npm ci && npm run dev` (or `npm run build && npm run preview`). `prepare` copies reports/{model,sim,vault,economics,evidence,change_*}.json + config/stations.json to web/public/data/reports/ (gitignored). Missing /data/*.json falls back to src/mock with a "sample data" badge.
- (builder-web) src/sched.ts + value.ts are exact ports of python sched/value; scheduler runs in a Web Worker on the live queries. `npx vitest run` reads python/tests/fixtures/sched_parity.json (schema: {params, queries, tiles, windows, runs: {"<rho>/<policy>": {sel, metrics}}}); skipped with a warning if missing. Verified against a self-generated fixture (15/15 identical). Builder-orbit: emit that schema, or tell me yours.
- (builder-web) Insights needs web/public/data/img/{aoi}_{t0,t1}.jpg (46x46 tile grid assumed in tile-index order per aoi/date); without them it shows the tile grid only.
- (orbit) sched.py has `LOOKAHEAD = 8`: a window stops after 8 consecutive does-not-fit pops. web/src/sched.ts line ~116 must be `if (inc > left) { skipped.push(e); if (skipped.length >= 8) break; continue; }` -- with that one-line change all 20 vitest parity cases pass; without it 17 fail.
- (orbit) tiles.json `{synthetic, classes[10], fields:[id,aoi,date,t_cap_min,lat,lon,cls,conf,cloud,kind,sev,ha,pA,pC,full_bytes], rows}`; results.json `{synthetic, rhos, policies, n_tiles, window_ids, by_rho:{"1|2|5|10":{B1..H2:{metrics:{value,ub,pct_ub,minutes_to_90,ttfi_min,bytes_sent,cloud_bytes,capacity_bytes,total_value}, level:[per-tile -1|0|1|2], timeline:{bytes,value,cum_value,cloud_bytes,cap}[per window]}}}}`; windows.json `{windows:[{id,station,start_min,end_min,dur_min,max_el,bytes}], first_capture_min}`; track.json `{step_s:30, lon[],lat[],alt_km[]}` (t_min = i*step_s/60 from 2025-01-15T00:00Z); queries.json `{params:{name:{value,assumption,source}}, queries}`.
- (orbit) Capture timing is a compressed replay (day j + real overpass time-of-day), orbit default horizon 5 d (not 3). PRD period 100.43 min is wrong for 786 km: computed 100.58 (Kepler/TLE), 100.63 nodal measured. Real vault inputs missing -> everything is `synthetic: true`; rerun `python -m herald sim` after M1-M4.
- (builder-data) Scenes: blr t0 2023-02-07 / t1 2025-02-06 / c1 2025-01-17 (30%) / c2 2026-06-28 (56%); sone 2023-04-05 / 2025-04-01 / c1 2026-09-13 (30%) / c2 2026-08-22 (55%); hasdeo 2023-02-09 / 2025-02-03 / c1 2023-06-19 (30%) / c2 2026-05-19 (56%). Clear pairs 0-0.3% SCL cloud. c1/c2 are not all between t0 and t1 (some after t1, up to 2026). S1: sone+hasdeo t0/t1/monsoon (2023-08). origin_xy = [x_min, y_max]. mgrs stored without "MGRS-" prefix. wc columns = classes 10,20,30,40,50,60,70,80,90,95,100.
- (builder-data) BOA: Earth Search items probed already offset-free (no +1000 in DN) for all chosen scenes, so boa_offset_applied=false everywhere (means "we subtracted 1000"). `vault build`/`labels` rewrite MANIFEST.json; re-run `vault manifest` after adding files (scores etc.). OSM construction labels are current (2026) polygons vs 2023/2025 imagery. vault/s1 (~34 MB each) and labels are not gitignored.
- (model) Backbone SSL4EO-S12 ResNet-18 (SENTINEL2_ALL_MOCO), conv1 sliced to B02,B03,B04,B08,B11; trained 1 frozen + 10 full epochs (97 s on GPU). NOTE torchgeo EuroSAT data has B8A last (B11 idx 10) while the weights use standard order (B11 idx 11); both handled. EuroSAT test (n=5400): top1 fp32 98.31%, int8 98.04% (drop 0.28 pt), ECE 0.089 -> 0.005 (T=0.586). int8 uses QOperator not QDQ (2x faster on ORT CPU).
- (model) Final (retrained, 98.11% fp32 / 98.02% int8 test, ECE 0.087 -> 0.0065, T=0.59). G2 FAIL: cloud MAE hasdeo 0.087 (gate 0.05; const baseline 0.296). Per-pixel 1x1-conv head tried (BCE vs SCL, balanced + prior-corrected): MAE 0.131, pixel P/R 0.86/0.52, WORSE, discarded. Cause: hasdeo has 9.2% thin-cirrus (SCL 10), ~0% in blr/sone training AOIs. Gate needs cirrus-bearing training scenes.
- (model) G4 FAIL on shared box (load 6-9): int8 b64 1.30 ms/chip default, 1.09 best (2 threads); fp32 2.59. Re-run `uv run python -m herald bench` idle. `uv run python -m herald` works without PYTHONPATH. vault/scores/ written for 12 files.
- (orbit) Real-input sim ran (synthetic:false, 19,044 tiles = 3 AOIs x 3 captures x 2116; invalid/sev=0 tiles gated to 0 value). reports/sim.json per rho: `ratio_vs_fifo`, `ratio_vs_b2`, `minutes_to_90` (null allowed), `minutes_to_match_fifo`, `fifo_minutes_used`, `minutes_saved_vs_fifo`, `ttfi_min`, `pct_ub`; plus `robustness` (H1 vs B1/B2, H2 packet fraction 0.3/0.5/0.7). sched.py/value.py logic unchanged; parity still passes. results.json now by_rho[..].metrics unchanged.
- (model) `uv run python -m herald score --change`: echg = 1 - cos(emb, t0 emb) saved as key `echg` in vault/scores/{aoi}_{c1,t1,c2}.npz (cloud already alongside under `cloud`, not masked). Ref = 128 B/tile, 264.5 KB/AOI. WEAK: blr t1 vs rules ROC-AUC 0.56 (ha>=1 n=647 vs ha==0 n=625), Spearman 0.12; injected-patch AUC 0.51/0.52/0.54/0.56/0.63 for 0.25/0.5/1/2/4 ha. EuroSAT-trained embedding encodes land-cover class, not change; use index-based change.py for the pitch, not echg. reports/audit_blr.json absent so audit AUC not run. G4 re-bench at load 3.6: int8 b64 1.39 default, 1.10 best (2 threads): still FAIL.
- (builder-change) Track A v2: reports/sites_blr.json = ranked leads by category (new_layout | building_construction | agri_ambiguous | lake_filling_lead), reports/audit_blr.json = reviewer visual audit (not field-verified): precision new_layout 0.40 (0.57 excl. unsure), building 0.27, agri_ambiguous 0.67 (correct = not construction), lake_filling_lead 0/10 so it is demoted to last. change_{aoi}.json now has `captures` {c1,t1,c2}: each vs t0, same frozen rules + valid gate (c2 is a 2026 scene so it includes seasonal change). Boeing anchor claim removed.
- (siting) `uv run python -m herald siting` (first run fetches NASA POWER/Copernicus DEM/WorldCover/Overpass into gitignored vault/siting/, ~9 min mostly Overpass rate limits; then offline). Score = net Rs/MW/yr; every Rs input is an assumption in config/siting.json. NASA POWER is 16 coarse points, no ridge wind; Global Wind Atlas is the upgrade.
- (siting) A1-A2 link: reports/siting.json a1_a2_link (pvg new-PV via blue/red ratio; QA reports/qa/pvg_solar.png ~33% precision on top tiles, construction rule noisy so use newpv_only fields). block_mw_capped = min(cluster_mw, 500).
- (siting) v3: adds access-road capex, T2M heat derate, JRC flood exclusion, water km, 8-neighbour clusters (cluster_mw); cached in vault/siting/. Solar blocks >=50 MW use "near-viable" cells (LCOE <= 1.2x tariff) because none is viable at base capex.
- (siting) Ranking is now LCOE (Rs/kWh, lower better; capex Rs 3.7 cr/MW cited, not tuned). At base capex 0 cells beat the Rs 2.6 tariff; at low capex 3.1 cr, 2,613 do. Wind not viable here.
- (siting) Pavagada validation is soft: OSM maps only ~1,017 ha of the ~5,261 ha park, and WorldCover 2021 shows its cells as ~50-65% cropland and ~15-30% built. Web: siting.json has bbox, cells (solar_score/wind_score 0=unranked else 1-100 rank), PNG overlays are UTM-aligned, placed by bbox.
- (builder-web, phase 2) Mock data removed; app errors if tiles/windows/track/queries json missing. Tabs: Mission, FIFO vs HERALD (results.json + sim.json robustness), Insights (Bengaluru ledger from sites_blr/survey_blr/audit_blr_lead/change_blr_summary), Siting (web/public/data/siting.json), Queries, Evidence (evidence.json: canonical-JSON hash verify in browser, images from /data/img/ev_*), Economics (4 payer cards), Hardware, About (Gates G1-G17 computed from report JSONs). `npm run prepare-data` (also run by dev/build) copies reports and writes slim change_{aoi}_summary.json.
- (builder-web) Evidence contract assumed: evidence.json = {cards:[...]} or [...]; card fields card_id, prev_hash, hash, images:{t0:{file?,sha256},t1:...} (or image_sha256), s1 (or s1_corroboration), caveat. Canonical text = Python json.dumps(sort_keys=True, separators=(",",":")) of card minus hash (ASCII-escaped or UTF-8 both accepted). audit_trackc.json: G15 reads top-level `precision` (or overall.precision), else pending.
- (model) wc head (MLP on frozen trunk, soft-CE on clear chips, test = eastern third of chip columns, 29-30 buffer): top-1 agreement with dominant WorldCover class 83.1% (majority baseline 67.2%), mean L1 0.418 (mean-fraction baseline 0.865); per AOI blr 78.2/0.527, sone 87.9/0.383, hasdeo 81.1/0.345. EuroSAT unchanged (98.11/98.02). WorldCover itself ~77% accurate: this is agreement with a noisy label, not ground truth. Confusion in reports/model.json `wc`.
- (model) Cloud with x1/x2 cirrus scenes: WORSE. Leave-one-AOI-out MAE with x1/x2: blr 0.134, hasdeo 0.151, sone 0.176; without: blr 0.086, hasdeo 0.087, sone 0.081. Kept without-x (hasdeo 0.087, gate 0.05 still FAIL). hasdeo has no x scenes yet. G4 re-bench at load ~3.7: int8 b64 1.43 default / 1.37 best: FAIL (box shared).
- (trackc) Sand v2 (change.py): JRC occurrence (cached vault/labels/jrc_sone.npz) + 500 m corridor; pits = rectangular (area/min-rect >= 0.7) new/growing water 0.2-5 ha whose dry ring is >=60% bare sand (drops paddies, ponds); disturbance secondary (dBSI+texture, not near t0 water, min width 8 px). Seasonal level/turbidity guards are in sand_detect/find_pits docstrings. Hasdeo clearing: min 45 px, t0 water margin excluded, mine_expansion = touches a >=10 ha bare patch at t0. Per-tile S1 (dvv/dvh, monsoon bright-point count, aggregate only). Injected pit recall 1.0 for 0.25-4 ha (square pits, optimistic). Lead masks in vault/labels/leadmask_{aoi}.npz.
- (trackc) reports/audit_trackc.json = reviewer visual audit, NOT field-verified. Sone is weak: sand_pits 1 real/3 unsure/4 wrong of 8, disturbance 0/2. Hasdeo mine_expansion 7/8 real, forest_clearing 2/7 real. Monsoon bright-point activity = 0 in the sone corridor (6 dry-season points): no monsoon signal found, reported honestly.
- (trackc) evidence.json contract: {chain_head, n_cards, genesis, audit, cards:[{card_id, aoi, kind, audit_label, lat, lon, bbox, ha, n_pits, dates{t0,t1,monsoon_s1}, cloud_pct{t0,t1}, indices{dndvi,dndbi,dmndwi,dbsi}, s1{dvv,dvh,monsoon_activity}, model{version,thresholds}, confidence, confidence_basis, images{t0,t1:{path,sha256}}, caveat, prev_hash, hash}]}. hash = sha256 of sorted-key compact JSON minus `hash`. `python -m herald evidence build|audit|verify`. Images 256 px at web/public/data/img/ev_{card_id}_{t0|t1}.jpg. config/value.json rupees_per_ha.C = 438000 (lowest SC 2008 forest NPV rate, assumption=true, sources in note).
- (model) Cloud 2x2, leave-one-AOI-out (train variant A = original dates only, B = + x1/x2 of training AOIs; test sets (i) original dates t0,t1,c1,c2 / (ii) x1+x2 cirrus / combined). MAE blr: A 0.074/0.310/0.152, B 0.105/0.225/0.145. hasdeo: A 0.089/0.491/0.223, B 0.141/0.300/0.194. sone: A 0.081/0.390/0.184, B 0.199/0.244/0.214. Mean combined A 0.186 vs B 0.184 (near tie); kept B (cirrus-robust). Honest: B costs 0.03-0.12 MAE on ordinary dates; G2 (<=0.05) FAILS on every set except A on (i) (blr 0.074 etc. still >0.05). Held-out hasdeo kept head: (i) 0.141, (ii) 0.300, combined 0.194 (const baseline 0.375). Head still chip-level on trunk features; cirrus needs a better head/features.
- (model) G4 bench with ORT_ENABLE_ALL: best int8 = threads=2,batch=64, 1.08 ms/chip (default threads b64 1.51, b128 1.29, b256 1.27; 4/6 threads slower). Load avg 9.0 at end of run (other builders running), start 2.9: FAIL, re-run when idle.
- (model) G2 final push FAIL: per-pixel spectral combiner (brightness, whiteness, HOT, NDSI, B11, NDVI; 33 params, in-graph) + learned blend, LOAO 2x2 (orig / cirrus / combined, blend MAE): A blr .095/.310/.167, hasdeo .095/.483/.224, sone .103/.388/.198; B blr .111/.222/.148, hasdeo .150/.314/.205, sone .167/.271/.202. Pixel-only is worse than the chip head (combined .19-.26) and the learned blend weight is ~0 on the kept hasdeo fold, so the pixel path is NOT exported (pix_on=False, saves latency). Kept B (mean combined 0.185); hasdeo combined 0.205. Likely floor: chips lack B10/B8A so SCL thin-cirrus (class 10) is not recoverable from 5 bands. Const baseline 0.37.
- (model) G4 best: int8 b64 0.881 ms/chip (run 1) and 1.00 (run 2): aff=cpus 0-7 (P-cores), intra_op_threads=8, allow_spinning=1, ORT_ENABLE_ALL, batch 64, QOperator. Borderline: load avg 2.3-9 during runs (other agents; never <1.5), so treat as ~1 ms. QDQ not re-tested (earlier ~2x slower), no pruning (G1 not risked). G1 98.11% fp32 / 98.02% int8 (drop 0.11 pt). ONNX now exported with the dynamo exporter, opset 18, single file, no deprecation warnings.
