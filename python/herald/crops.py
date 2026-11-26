"""`python -m herald crops`: sharp, native-10 m site imagery for the dashboard's detail panel.

For every ranked lead (top construction sites + lake leads in reports/sites_blr.json) and every evidence card,
cut a 3x3-chip neighbourhood (192x192 px = 1.92 km at 10 m) from the vault for each available date, with one
shared 2-98% stretch per AOI so dates compare, plus a transparent change mask. Writes
web/public/data/img/sites/{site_id}_{date}.jpg, {site_id}_mask.png and web/public/data/sites_index.json.
"""
import json

import numpy as np
from PIL import Image

from herald import paths
from herald.change import C, G, mosaic

DATES = ("t0", "c1", "t1", "c2")
N_CONSTRUCTION = 120
OUT = paths.WEB_DATA / "img" / "sites"


def window(row: int, col: int, k: int = 3) -> tuple[int, int]:
    """Top-left chip (row, col) of a k x k window centred on (row, col), shifted to stay inside the grid."""
    r0 = min(max(row - k // 2, 0), G - k)
    c0 = min(max(col - k // 2, 0), G - k)
    return r0, c0


def nearest_tile(meta: dict, lat: float, lon: float) -> tuple[int, int]:
    t = meta["tiles"]
    i = int(np.argmin([(x["lat"] - lat) ** 2 + (x["lon"] - lon) ** 2 for x in t]))
    return t[i]["row"], t[i]["col"]


def _stretch(aoi: str):
    ref = []
    for d in ("t0", "t1"):
        x = np.load(paths.CHIPS / f"{aoi}_{d}.npy", mmap_mode="r")
        ref.append(np.asarray(x[::7, [2, 1, 0], ::4, ::4]).transpose(1, 0, 2, 3).reshape(3, -1).astype(np.float32) / 1e4)
    ref = np.concatenate(ref, axis=1)
    ref = ref[:, ref.max(0) > 0]
    return np.percentile(ref, 2, axis=1)[:, None, None], np.percentile(ref, 98, axis=1)[:, None, None]


def _rgb(chips, r0: int, c0: int, lo, hi) -> np.ndarray:
    idx = [(r0 + i) * G + (c0 + j) for i in range(3) for j in range(3)]
    a = np.asarray(chips[idx][:, [2, 1, 0]]).astype(np.float32) / 1e4           # [9,3,64,64]
    a = a.reshape(3, 3, 3, C, C).transpose(2, 0, 3, 1, 4).reshape(3, 3 * C, 3 * C)
    return (np.clip((a - lo) / (hi - lo), 0, 1) ** (1 / 1.6) * 255).astype(np.uint8).transpose(1, 2, 0)


def _mask(aoi: str):
    """Full-res [2944,2944] bool change mask: Track C lead masks, else the half-res change overlay upsampled."""
    f = paths.LABELS / f"leadmask_{aoi}.npz"
    if f.exists():
        d = np.load(f)
        return mosaic((d["a"] > 0) | (d["b"] > 0))
    png = paths.WEB_DATA / "img" / f"{aoi}_change.png"
    if not png.exists():
        return None
    half = np.asarray(Image.open(png))[..., 3] > 0
    return half.repeat(2, 0).repeat(2, 1)   # shortcut: blr mask is stored at 20 m; upgrade by saving the 10 m mask in change.py


def _sites() -> list[dict]:
    out = []
    s = json.loads((paths.REPORTS / "sites_blr.json").read_text(encoding="utf-8"))
    cons = [x for x in s["sites"] if x["category"] in ("new_layout", "building_construction")]
    lakes = [x for x in s["sites"] if x["category"] == "lake_filling_lead"]
    for x in cons[:N_CONSTRUCTION] + lakes:
        out.append({"id": f"blr_site{x['site']}" if "site" in x else f"blr_lake{x['osm_id']}", "aoi": "blr", "lat": x["lat"], "lon": x["lon"], "kind": x["category"], "ha": x["ha"]})
    ev = json.loads((paths.REPORTS / "evidence.json").read_text(encoding="utf-8"))
    for c in ev.get("cards", ev):
        out.append({"id": f"ev_{c['card_id']}", "aoi": c["aoi"], "lat": c["lat"], "lon": c["lon"], "kind": c["kind"], "ha": c["ha"]})
    return out


def main(argv: list[str]) -> int:
    paths.ensure(OUT)
    sites, index = _sites(), {}
    for aoi in sorted({x["aoi"] for x in sites}):
        meta = json.loads((paths.VAULT / "meta" / f"{aoi}.json").read_text(encoding="utf-8"))
        lab = np.load(paths.LABELS / f"{aoi}.npz")
        lo, hi = _stretch(aoi)
        chips = {d: np.load(paths.CHIPS / f"{aoi}_{d}.npy", mmap_mode="r") for d in DATES if (paths.CHIPS / f"{aoi}_{d}.npy").exists()}
        dates = json.loads((paths.VAULT / "scenes.json").read_text(encoding="utf-8"))[aoi]["dates"]
        mask = _mask(aoi)
        for x in (s for s in sites if s["aoi"] == aoi):
            r0, c0 = window(*nearest_tile(meta, x["lat"], x["lon"]))
            idx = [(r0 + i) * G + (c0 + j) for i in range(3) for j in range(3)]
            files, cloud = {}, {}
            for d, ch in chips.items():
                Image.fromarray(_rgb(ch, r0, c0, lo, hi)).save(OUT / f"{x['id']}_{d}.jpg", quality=95, subsampling=0)
                files[d] = f"img/sites/{x['id']}_{d}.jpg"
                if f"cloud_{d}" in lab:
                    cloud[d] = round(float(lab[f"cloud_{d}"][idx].mean()), 3)
            if mask is not None:
                m = mask[r0 * C:(r0 + 3) * C, c0 * C:(c0 + 3) * C]
                rgba = np.zeros((*m.shape, 4), np.uint8)
                rgba[m] = (255, 64, 48, 190)
                Image.fromarray(rgba).save(OUT / f"{x['id']}_mask.png", optimize=True)
                files["mask"] = f"img/sites/{x['id']}_mask.png"
            t = meta["tiles"]
            sw, ne = t[(r0 + 2) * G + c0], t[r0 * G + c0 + 2]
            index[x["id"]] = {**x, "window_chips": [r0, c0, 3], "px_m": 10, "size_px": 3 * C,
                              "bbox": [sw["bbox"][0], sw["bbox"][1], ne["bbox"][2], ne["bbox"][3]],
                              "dates": {d: dates[d]["datetime"][:10] for d in chips if d in dates},
                              "cloud": cloud, "files": files}
    s1_crops(index)
    lake_processing(index)
    onboard_sample(index)
    (paths.WEB_DATA / "sites_index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    print(f"{len(index)} sites -> {OUT}")
    return 0


def s1_crops(index: dict) -> None:
    """Sentinel-1 VH (dB) 3x3-chip crops for evidence sites whose AOI has radar: t0, t1, monsoon (grey, -25..-5 dB)."""
    for sid, x in index.items():
        if not sid.startswith("ev_"):
            continue
        r0, c0, _ = x["window_chips"]
        idx = [(r0 + i) * G + (c0 + j) for i in range(3) for j in range(3)]
        for lab in ("t0", "t1", "monsoon"):
            f = paths.S1 / f"{x['aoi']}_{lab}.npy"
            if not f.exists():
                continue
            vh = np.asarray(np.load(f, mmap_mode="r")[idx][:, 1]).astype(np.float32)          # [9,64,64] dB
            vh = vh.reshape(3, 3, C, C).transpose(0, 2, 1, 3).reshape(3 * C, 3 * C)
            g = (np.clip((np.nan_to_num(vh, nan=-25) + 25) / 20, 0, 1) * 255).astype(np.uint8)
            Image.fromarray(g).save(OUT / f"{sid}_s1vh_{lab}.png", optimize=True)
            x["files"][f"s1vh_{lab}"] = f"img/sites/{sid}_s1vh_{lab}.png"
            x.setdefault("s1_mean_vh_db", {})[lab] = round(float(np.nanmean(vh)), 2)


def onboard_sample(index: dict, n_sites: int = 24) -> None:
    """Raw uint16 chips + the ground model's outputs, so the browser can run the int8 ONNX model and prove parity."""
    picks, rows = [], []
    for sid, x in list(index.items())[:n_sites]:
        r0, c0, _ = x["window_chips"]
        i = (r0 + 1) * G + (c0 + 1)                                                        # centre chip of the window
        for d in ("t0", "t1"):
            f, sc = paths.CHIPS / f"{x['aoi']}_{d}.npy", paths.SCORES / f"{x['aoi']}_{d}.npz"
            if not (f.exists() and sc.exists()):
                continue
            z = np.load(sc)
            picks.append(np.asarray(np.load(f, mmap_mode="r")[i], dtype="<u2"))
            rows.append({"site": sid, "aoi": x["aoi"], "date": d, "tile": i, "lat": x["lat"], "lon": x["lon"],
                         "ground": {"probs": [round(float(v), 4) for v in z["probs"][i]], "cloud": round(float(z["cloud"][i]), 4)}})
    np.stack(picks).astype("<u2").tofile(paths.WEB_DATA / "onboard_sample.bin")
    norm = json.loads((paths.MODELS / "norm.json").read_text(encoding="utf-8"))
    rep = json.loads((paths.REPORTS / "model.json").read_text(encoding="utf-8"))
    meta = {"dtype": "uint16-le", "shape": [len(picks), 5, C, C], "scale": 1e-4, "bands": norm["bands"], "mean": norm["mean"], "std": norm["std"],
            "temperature": rep["eurosat"]["temperature"], "classes": rep["classes"], "model": "models/herald_int8.onnx", "chips": rows}
    (paths.WEB_DATA / "onboard_sample.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")


def lake_processing(index: dict) -> None:
    """Per lake lead and date: MNDWI (grey) and water-mask PNGs on the 3x3-chip window, plus water ha per date (lakes.json)."""
    out, sites = [], json.loads((paths.REPORTS / "sites_blr.json").read_text(encoding="utf-8"))["sites"]
    lakes = {f"blr_lake{x['osm_id']}": x for x in sites if x["category"] == "lake_filling_lead"}
    for sid, rep in lakes.items():
        x = index.get(sid)
        if not x:
            continue
        r0, c0, _ = x["window_chips"]
        idx = [(r0 + i) * G + (c0 + j) for i in range(3) for j in range(3)]
        rec = {"id": sid, "name": rep.get("lake"), "acres": rep.get("lake_acres"), "lat": x["lat"], "lon": x["lon"], "dates": {},
               "report": {k: rep.get(k) for k in ("water_t0_ha", "water_t1_ha", "lost_to_veg_ha", "lost_to_bare_ha", "lost_to_built_ha")}}
        for d in DATES:
            f, sf = paths.CHIPS / f"{x['aoi']}_{d}.npy", paths.CHIPS / f"{x['aoi']}_{d}_scl.npy"
            if not f.exists():
                continue
            a = np.asarray(np.load(f, mmap_mode="r")[idx]).astype(np.float32) / 1e4          # [9,5,64,64]
            a = a.reshape(3, 3, 5, C, C).transpose(2, 0, 3, 1, 4).reshape(5, 3 * C, 3 * C)
            g, sw = a[1], a[4]
            mndwi = (g - sw) / np.maximum(g + sw, 1e-6)
            scl = np.asarray(np.load(sf, mmap_mode="r")[idx]).reshape(3, 3, C, C).transpose(0, 2, 1, 3).reshape(3 * C, 3 * C) if sf.exists() else np.full((3 * C, 3 * C), 4)
            valid = ~np.isin(scl, (0, 1, 3, 8, 9, 10, 11))
            water = (mndwi > 0) & valid
            Image.fromarray((np.clip((mndwi + 0.6) / 1.2, 0, 1) * 255).astype(np.uint8)).save(OUT / f"{sid}_mndwi_{d}.png", optimize=True)
            rgba = np.zeros((*water.shape, 4), np.uint8)
            rgba[water] = (56, 189, 248, 200)
            rgba[~valid] = (148, 163, 184, 140)
            Image.fromarray(rgba).save(OUT / f"{sid}_water_{d}.png", optimize=True)
            rec["dates"][d] = {"date": x["dates"].get(d), "water_ha": round(float(water.sum()) / 100, 2), "valid": round(float(valid.mean()), 3),
                               "mndwi": f"img/sites/{sid}_mndwi_{d}.png", "water": f"img/sites/{sid}_water_{d}.png", "rgb": x["files"].get(d)}
        out.append(rec)
    out.sort(key=lambda r: -(r["report"].get("water_t0_ha") or 0))
    (paths.WEB_DATA / "lakes.json").write_text(json.dumps({"note": "MNDWI = (B03 - B11) / (B03 + B11); water = MNDWI > 0 on clear pixels (SCL); window 1.92 km at 10 m", "lakes": out}, separators=(",", ":")), encoding="utf-8")
