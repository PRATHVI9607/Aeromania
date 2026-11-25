"""Single source of truth for repo paths. Import these; never hard-code paths."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VAULT = ROOT / "vault"
CHIPS = VAULT / "chips"          # gitignored: uint16 chip arrays
RAW = VAULT / "raw"              # gitignored: optional raw scene cache
LABELS = VAULT / "labels"
S1 = VAULT / "s1"
SCORES = VAULT / "scores"
MODELS = ROOT / "models"         # committed: int8 onnx + small json
REPORTS = ROOT / "reports"
WEB = ROOT / "web"
WEB_DATA = WEB / "public" / "data"
CONFIG = ROOT / "config"

BANDS = ["B02", "B03", "B04", "B08", "B11"]   # chip channel order
CHIP = 64                                       # pixels, 10 m GSD
CHIP_BYTES = CHIP * CHIP * len(BANDS) * 2       # 40,960 B raw uint16
CHIP_HA = CHIP * CHIP * 100 / 10_000            # 40.96 ha


def ensure(*dirs: Path) -> None:
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
