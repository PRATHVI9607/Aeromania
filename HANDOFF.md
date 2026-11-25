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
| M8 evidence + economics | — | later | evidence.json, economics.json |
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
- `vault/scores/{aoi}_{date}.npz`: `probs` [2116,10] calibrated, `cloud` [2116], `emb` [2116,64] float16.
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
