"""`python -m herald samples`: 640x640 px 5-band GeoTIFFs (uint16 DN=refl*1e4, 10 m) cut from vault chips for the web Lab."""
import json

import numpy as np
import rasterio
from rasterio.transform import from_origin

from .paths import BANDS, CHIP, CHIPS, REPORTS, VAULT, WEB, ensure

N = 10  # tiles per side -> 640 px
OUT = WEB / "public" / "samples"


def nearest(meta: dict, lat: float, lon: float) -> int:
    return min(meta["tiles"], key=lambda t: (t["lat"] - lat) ** 2 + (t["lon"] - lon) ** 2)["i"]


def cut(aoi: str, date: str, tile: int, name: str) -> str:
    meta = json.loads((VAULT / "meta" / f"{aoi}.json").read_text(encoding="utf-8"))
    g = meta["grid"][0]
    r0 = min(max(tile // g - N // 2, 0), g - N)
    c0 = min(max(tile % g - N // 2, 0), g - N)
    a = np.load(CHIPS / f"{aoi}_{date}.npy", mmap_mode="r")
    img = np.zeros((5, N * CHIP, N * CHIP), np.uint16)
    for r in range(N):
        for c in range(N):
            img[:, r * CHIP:(r + 1) * CHIP, c * CHIP:(c + 1) * CHIP] = a[(r0 + r) * g + c0 + c]
    ox, oy = meta["origin_xy"]  # upper-left of the 46x46 grid, 640 m per tile
    tf = from_origin(ox + c0 * CHIP * 10, oy - r0 * CHIP * 10, 10, 10)
    p = OUT / name
    with rasterio.open(p, "w", driver="GTiff", width=N * CHIP, height=N * CHIP, count=5, dtype="uint16",
                       crs=f"EPSG:{meta['epsg']}", transform=tf, compress="lzw", predictor=2) as d:
        d.write(img)
        d.descriptions = tuple(BANDS)
    return f"{name}: {aoi} {date} tiles rows {r0}-{r0 + N - 1} cols {c0}-{c0 + N - 1}, {p.stat().st_size / 1e6:.1f} MB"


def main(argv: list[str]) -> int:
    ensure(OUT)
    blr = json.loads((VAULT / "meta" / "blr.json").read_text(encoding="utf-8"))
    top = next(s for s in json.loads((REPORTS / "sites_blr.json").read_text(encoding="utf-8"))["sites"] if s["rank"] == 1)
    tb = nearest(blr, top["lat"], top["lon"])
    cards = json.loads((WEB / "public" / "data" / "evidence.json").read_text(encoding="utf-8"))["cards"]
    card = next(c for c in cards if c["kind"] == "mine_expansion")
    has = json.loads((VAULT / "meta" / "hasdeo.json").read_text(encoding="utf-8"))
    th = nearest(has, card["lat"], card["lon"])
    lines = [
        cut("blr", "t1", tb, "blr_construction.tif"),
        cut("hasdeo", "t1", th, "hasdeo_mine.tif"),
        cut("blr", "c2", tb, "blr_cloudy.tif"),
    ]
    print("\n".join(lines))
    (OUT / "README.txt").write_text(
        "HERALD Lab samples: 640x640 px, 10 m, uint16 DN = reflectance x 10000, LZW GeoTIFF, Sentinel-2 L2A.\n"
        "Band order: B02,B03,B04,B08,B11 (blue,green,red,NIR,SWIR1).\n"
        "Own data: Copernicus Browser multi-band GeoTIFF with raw bands (UINT16) in that order (5 bands),\n"
        "or a full 12/13-band stack in S2 order (B01..B12 incl. B8A) - the Lab picks the 5 it needs.\n"
        "RGB-only (3 bands) is rejected: the onboard model needs NIR and SWIR.\n\n" + "\n".join(lines) + "\n",
        encoding="utf-8", newline="\n")
    return 0
