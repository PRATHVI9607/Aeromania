"""Labels: SCL cloud/nodata fractions, ESA WorldCover 2021 fractions, OSM landuse=construction (blr).

usage: python -m herald labels [--aoi blr]   -> vault/labels/{aoi}.npz, reports/qa/labels_{aoi}.png
wc column order = WorldCover legend: 10,20,30,40,50,60,70,80,90,95,100 (tree,shrub,grass,crop,built,bare,snow,water,wetland,mangrove,moss).
"""
import argparse
import json
import math
import sys
import time

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.vrt import WarpedVRT
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import linemerge, polygonize, transform as shp_transform

from herald.paths import CHIPS, LABELS, REPORTS, VAULT, ensure
from herald.vault import (CLOUD_CLASSES, CROP, DATES, ENV, NCHIP, SIDE, aoi_transform, load_aois, log, retry,
                          scl_fractions, tile_chips, write_manifest)

WC_CLASSES = (10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100)
WC_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif"
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")


def wc_tile_names(west, south, east, north):
    names = []
    for la in range(math.floor(south / 3) * 3, math.floor(north / 3) * 3 + 1, 3):
        for lo in range(math.floor(west / 3) * 3, math.floor(east / 3) * 3 + 1, 3):
            names.append(f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}")
    return names


def chip_fractions(mask: np.ndarray) -> np.ndarray:
    """Boolean/0-1 raster [>=2944,>=2944] -> float32 [2116] chip fractions."""
    return tile_chips(mask[None].astype(np.float32))[:, 0].mean(axis=(1, 2)).astype(np.float32)


def worldcover(meta) -> np.ndarray:
    bb = np.array([t["bbox"] for t in meta["tiles"]])
    tr = aoi_transform(meta["origin_xy"])
    grid = np.zeros((SIDE, SIDE), np.uint8)
    for name in wc_tile_names(bb[:, 0].min(), bb[:, 1].min(), bb[:, 2].max(), bb[:, 3].max()):
        def go(name=name):
            with rasterio.Env(**ENV), rasterio.open(WC_URL.format(name)) as src, \
                    WarpedVRT(src, crs=f"EPSG:{meta['epsg']}", transform=tr, width=SIDE, height=SIDE,
                              resampling=Resampling.nearest, src_nodata=0, nodata=0) as v:
                return v.read(1)
        try:
            a = retry(go)
        except rasterio.errors.RasterioIOError as e:  # tile absent (ocean) is legal; log and continue
            log(f"  worldcover {name} unavailable: {str(e)[:80]}")
            continue
        grid = np.where(grid == 0, a, grid)
    log(f"  worldcover class mix: " + ", ".join(f"{c}:{(grid == c).mean():.1%}" for c in WC_CLASSES if (grid == c).any()))
    return np.stack([chip_fractions(grid == c) for c in WC_CLASSES], axis=1)


def osm_construction(meta, cache) -> np.ndarray:
    bb = np.array([t["bbox"] for t in meta["tiles"]])
    s, w, n, e = bb[:, 1].min(), bb[:, 0].min(), bb[:, 3].max(), bb[:, 2].max()
    if not cache.exists():
        q = f'[out:json][timeout:180];(way["landuse"="construction"]({s},{w},{n},{e});relation["landuse"="construction"]({s},{w},{n},{e}););out geom;'
        for k in range(6):
            url = OVERPASS[k % 2]
            try:
                r = requests.post(url, data={"data": q}, timeout=240, headers={"User-Agent": "herald-hackathon/0.1"})
                r.raise_for_status()
                cache.write_text(json.dumps(r.json()), encoding="utf-8")
                break
            except Exception as ex:
                log(f"  overpass {url} failed: {str(ex)[:80]}")
                time.sleep(5 * (k + 1))
        else:
            raise RuntimeError("overpass unavailable")
    polys = []
    for el in json.loads(cache.read_text(encoding="utf-8"))["elements"]:
        if el["type"] == "way" and len(el.get("geometry", [])) >= 4:
            pts = [(g["lon"], g["lat"]) for g in el["geometry"]]
            if pts[0] == pts[-1]:
                polys.append(Polygon(pts))
        elif el["type"] == "relation":  # shortcut: outer rings only, holes ignored
            lines = [LineString([(g["lon"], g["lat"]) for g in m["geometry"]]) for m in el["members"]
                     if m.get("role") == "outer" and len(m.get("geometry", [])) >= 2]
            if lines:
                polys += list(polygonize(linemerge(lines)))
    log(f"  osm construction polygons: {len(polys)}")
    if not polys:
        return np.zeros(NCHIP, np.float32)
    t = Transformer.from_crs(4326, meta["epsg"], always_xy=True)
    geoms = [shp_transform(t.transform, p.buffer(0)) for p in polys]
    mask = rasterize([(g, 1) for g in geoms if not g.is_empty], out_shape=(SIDE, SIDE),
                     transform=aoi_transform(meta["origin_xy"]), dtype="uint8")
    return chip_fractions(mask)


def qa_png(aid, date, scl, chips, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    cloud, nodata = scl_fractions(scl)
    ok = np.where(nodata < 0.5)[0]
    pick = ok[np.argsort(cloud[ok])][np.linspace(0, len(ok) - 1, 16).astype(int)]  # spread low->high cloud
    fig, ax = plt.subplots(4, 4, figsize=(8, 8))
    for a, i in zip(ax.ravel(), pick):
        rgb = np.clip(chips[i, [2, 1, 0]].astype(np.float32) / 3000, 0, 1).transpose(1, 2, 0) ** 0.8
        a.imshow(rgb)
        m = np.isin(scl[i], CLOUD_CLASSES)
        a.imshow(np.where(m[..., None], [1, 0, 0, 0.45], [0, 0, 0, 0]).astype(np.float32))
        a.set_title(f"#{i} cloud {cloud[i]:.0%}", fontsize=7)
        a.axis("off")
    fig.suptitle(f"{aid} {date}: RGB + SCL cloud (red)", fontsize=9)
    fig.tight_layout()
    ensure(path.parent)
    fig.savefig(path, dpi=100)
    plt.close(fig)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    ap = argparse.ArgumentParser(prog="herald labels")
    ap.add_argument("cmd", choices=["labels"])
    ap.add_argument("--aoi")
    a = ap.parse_args(argv)
    ensure(LABELS)
    for aoi in load_aois():
        aid = aoi["id"]
        if a.aoi not in (None, aid):
            continue
        meta = json.loads((VAULT / "meta" / f"{aid}.json").read_text(encoding="utf-8"))
        out = {}
        for d in DATES:
            p = CHIPS / f"{aid}_{d}_scl.npy"
            if p.exists():
                out[f"cloud_{d}"], out[f"nodata_{d}"] = (v.astype(np.float32) for v in scl_fractions(np.load(p)))
        log(f"{aid}: cloud " + ", ".join(f"{k[6:]}={v.mean():.1%}" for k, v in out.items() if k.startswith("cloud_")))
        out["wc"] = worldcover(meta).astype(np.float32)
        out["osm_constr"] = osm_construction(meta, LABELS / "osm_blr.json") if aid == "blr" \
            else np.zeros(NCHIP, np.float32)
        np.savez_compressed(LABELS / f"{aid}.npz", **out)
        d = "c1" if (CHIPS / f"{aid}_c1.npy").exists() else "t0"
        qa_png(aid, d, np.load(CHIPS / f"{aid}_{d}_scl.npy"), np.load(CHIPS / f"{aid}_{d}.npy", mmap_mode="r"),
               REPORTS / "qa" / f"labels_{aid}.png")
    write_manifest()
    from herald.vault import write_report
    write_report(load_aois())
    return 0


if __name__ == "__main__":
    sys.exit(main(["labels", *sys.argv[1:]]))
