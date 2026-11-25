# HANDOFF — HERALD live build state

Read this + CLAUDE.md before touching code. Do NOT re-read PRD.md end to end; the sections you need are cited by number.
When you finish a module: update **Status** row, add 1–3 lines under **Notes from builders**, commit (no AI attribution trailer).

Clock: live 12 h hackathon build, started 2026-11-25 ~21:40 local. Priority: Track A → B → C. Cut order: PRD §15.

## Status

| Module | Owner | State | Key outputs |
|---|---|---|---|
| M0 skeleton | lead | done | pyproject (uv, py3.11, torch cu126), cli.py, paths.py, config/aois.json |
| M1 vault + M2 labels (+S1) | builder-data | todo | vault/*, reports/vault.json |
| M3 model | builder-model | todo | models/herald_int8.onnx, reports/model.json |
| M4 change | builder-change | blocked on M1 | reports/change_*.json, web/public/data/img/* |
| M5 value+sched, M6 sim, orbit | builder-orbit | todo | windows.json, track.json, results.json |
| M7 web | builder-web | todo | web/ (Vite+React+TS+Cesium) |
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

## Notes from builders
- (lead) PRD says orbit.py "DONE" but it was not in the folder; builder-orbit writes it.
