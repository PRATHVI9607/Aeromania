# HERALD — the satellite that sends home answers, not pictures

Aeromania '26 Mach-A-Thon ("Orbit to Economy: AI in Space"). One system, three tracks:

- **Track A (Read the Planet)**
  - **A1:** Bengaluru's construction ledger. New layouts and buildings are detected from real Sentinel-2 imagery (2023→2025) and checked against lake and drain no-build zones.
  - **A2:** solar and wind siting around Pavagada, ranked by LCOE and validated against the real solar park.
- **Track B (Build the Orbit):** an onboard int8 AI scores every tile, and a value-per-byte scheduler fills real ground-station contact windows. It is compared against FIFO and a cloud filter on a Sentinel-2-like orbit.
- **Track C (Guard the Nation):** forest lost to mine expansion (Hasdeo Arand) and river sand mining (Sone). Findings go out as hash-chained, tamper-evident evidence cards. Land cover only, never people.

Specification and decisions: [PRD.md](PRD.md). Live build state and data contracts: [HANDOFF.md](HANDOFF.md). Judge Q&A prep: [docs/judge_qa.md](docs/judge_qa.md).

## Run the dashboard (no training, no network)

Needs Node 20+. Works on Windows and Linux.

```
cd web
npm ci
npm run build
npm run preview
```

Open the printed `http://127.0.0.1:...` URL. All numbers come from the committed JSON in `web/public/data/` and `reports/`.

## Run the pipeline

Needs [uv](https://docs.astral.sh/uv/). It installs Python 3.11 and the dependencies, with CUDA torch if a GPU is present and CPU otherwise.

```
uv sync
uv run python -m herald vault build      # one-time download of the Sentinel-2/1 data (network)
uv run python -m herald labels           # one-time labels: SCL cloud, WorldCover, OSM (network)
uv run python -m herald all              # everything else, offline from the vault
uv run python -m herald all --quick      # fast smoke run
uv run python -m herald all --train --web  # also retrain the model and rebuild the dashboard
uv run pytest -q                         # Python tests
cd web && npx vitest run                 # scheduler parity + evidence-hash tests
```

Individual steps: `orbit`, `vault build|verify|pack`, `labels`, `train`, `calibrate`, `export`, `score`, `change`, `evidence build|verify`, `siting`, `sim`, `bench`.

## Layout

```
python/herald/   pipeline (orbit, vault, labels, model, change, siting, value, sched, sim, evidence, bench)
python/tests/    pytest, incl. the Python<->TypeScript scheduler parity fixture
web/             React + Vite + TypeScript + CesiumJS dashboard (static, offline, no Cesium ion)
config/          AOIs, value-model assumptions (with sources), change thresholds, siting parameters
models/          int8 + fp32 ONNX onboard model, normalization
reports/         every measured number (model, change, audits, siting, sim, evidence)
vault/           data vault; large arrays are local only, metadata and labels are committed
```

## Honest limits

These are simulated replays of real archived imagery, not live tasking. At 10 m the data can't count floors, resolve small houses or draw property lines. Labels are weak (OSM, WorldCover ≈ 77%), and the audits are reviewer visual checks, not field visits. Every rupee figure is a sourced assumption. The change engine is rule-based; an onboard embedding change score was tried and rejected (AUC 0.56). Sand-pit detection at 10 m is experimental (precision 0.12). The full list is in the dashboard's About/Limits view and in PRD §19.

## Data and credits

ESA Copernicus Sentinel-2 L2A and Sentinel-1 RTC (via Element84 Earth Search and Microsoft Planetary Computer), ESA WorldCover (CC-BY 4.0), JRC Global Surface Water, Copernicus DEM GLO-30, NASA POWER, OpenStreetMap contributors (ODbL), BBMP ward boundaries (KGIS via DataMeet), SSL4EO-S12 weights via torchgeo, EuroSAT, Skyfield. Full source list: PRD §21.
