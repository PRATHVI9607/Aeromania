"""Vault builder: S2 L2A chips (Earth Search), S1 RTC dB (Planetary Computer), manifest/verify/pack.

usage: python -m herald vault build [--aoi blr] [--quick] | verify | pack | manifest
origin_xy in scenes.json = [x_min, y_max] (upper-left corner of the 3000x3000 px grid, metres, epsg of the S2 tile).
"""
import argparse
import hashlib
import json
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT

from herald.paths import BANDS, CHIP, CHIPS, CONFIG, LABELS, REPORTS, S1, VAULT, ensure

S2_STAC = "https://earth-search.aws.element84.com/v1"
S1_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
ASSET = {"B02": "blue", "B03": "green", "B04": "red", "B08": "nir", "B11": "swir16"}
GRID, SIDE = 46, 3000
NCHIP = GRID * GRID
CROP = GRID * CHIP  # 2944; the 56 px remainder at right/bottom is dropped
CLOUD_CLASSES = (3, 8, 9, 10)
BOA_OFFSET = 1000
ENV = dict(AWS_NO_SIGN_REQUEST="YES", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
           GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2")
DATES = ("t0", "t1", "c1", "c2")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def retry(fn, tries=6):
    for k in range(tries):
        try:
            return fn()
        except Exception as e:  # network / GDAL I/O
            if k == tries - 1:
                raise
            log(f"retry {k + 1}: {type(e).__name__} {str(e)[:100]}")
            time.sleep(2 ** k)


# ---------- pure helpers (unit-tested) ----------
def needs_boa_offset(props: dict, nir=None) -> bool:
    """Baseline >= 04.00 stores DN = refl*10000 + 1000 (BOA_ADD_OFFSET = -1000) unless Earth Search already
    removed it (`earthsearch:boa_offset_applied`). Probed: some items are flagged False yet already offset-free,
    so with pixel data we also require the 0.1th percentile of non-zero NIR >= 900 (offset data cannot go below 1000)."""
    need = float(props.get("s2:processing_baseline", "0") or 0) >= 4.0 and not props.get("earthsearch:boa_offset_applied")
    if need and nir is not None:
        nz = nir[nir > 0]
        need = bool(nz.size and np.percentile(nz, 0.1) >= 900)
    return need


def harmonize(dn: np.ndarray, offset: bool) -> np.ndarray:
    """uint16 DN -> uint16 refl*10000 clipped >= 0 (DN 0 = nodata stays 0)."""
    if not offset:
        return dn.astype(np.uint16)
    return np.clip(dn.astype(np.int32) - BOA_OFFSET, 0, None).astype(np.uint16)


def scl_fractions(scl: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(cloud, nodata) fractions over the last two axes of an SCL array."""
    return np.isin(scl, CLOUD_CLASSES).mean(axis=(-2, -1)), (scl == 0).mean(axis=(-2, -1))


def tile_chips(arr: np.ndarray) -> np.ndarray:
    """[C,H>=2944,W>=2944] -> [2116,C,64,64], chip i = row*46+col."""
    c = arr.shape[0]
    a = arr[:, :CROP, :CROP].reshape(c, GRID, CHIP, GRID, CHIP)
    return np.ascontiguousarray(a.transpose(1, 3, 0, 2, 4).reshape(NCHIP, c, CHIP, CHIP))


def tile_scl(scl: np.ndarray) -> np.ndarray:
    return tile_chips(scl[None])[:, 0]


def utm_epsg(lat: float, lon: float) -> int:
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def sha256(p) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def vault_files(root):
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if p.is_file() and rel.parts[0] != "raw" and p.name not in ("MANIFEST.json", "herald_vault.zip") \
                and not p.name.endswith(".tmp"):
            yield rel


def write_manifest(root=VAULT) -> dict:
    m = {rel.as_posix(): sha256(root / rel) for rel in vault_files(root)}
    (root / "MANIFEST.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
    return m


def verify_manifest(root=VAULT) -> list[str]:
    m = json.loads((root / "MANIFEST.json").read_text(encoding="utf-8"))
    return [r for r, h in m.items() if not (root / r).is_file() or sha256(root / r) != h]


def save_atomic(path, arr):
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        np.save(f, arr)
    tmp.replace(path)


def aoi_transform(origin) -> Affine:
    return Affine(10, 0, origin[0], 0, -10, origin[1])


def tiles_meta(aoi, epsg, origin) -> dict:
    t = Transformer.from_crs(epsg, 4326, always_xy=True)
    tiles = []
    for r in range(GRID):
        for c in range(GRID):
            x0, y1 = origin[0] + c * CHIP * 10, origin[1] - r * CHIP * 10
            x1, y0 = x0 + CHIP * 10, y1 - CHIP * 10
            xs, ys = t.transform([x0, x1, x0, x1, (x0 + x1) / 2], [y0, y0, y1, y1, (y0 + y1) / 2])
            tiles.append(dict(i=r * GRID + c, row=r, col=c, lat=round(ys[4], 6), lon=round(xs[4], 6),
                              bbox=[round(min(xs[:4]), 6), round(min(ys[:4]), 6),
                                    round(max(xs[:4]), 6), round(max(ys[:4]), 6)]))
    return dict(aoi=aoi, epsg=epsg, origin_xy=list(origin), grid=[GRID, GRID], tiles=tiles)


# ---------- Sentinel-2 ----------
def read_asset(href, origin, epsg, res, scale20=False):
    """Read exactly the AOI window (3000x3000 @10 m). scale20: asset is 20 m, resample to the 10 m grid."""
    def go():
        with rasterio.Env(**ENV), rasterio.open(href) as src:
            assert src.crs.to_epsg() == epsg, (src.crs, epsg)
            win = rasterio.windows.from_bounds(origin[0], origin[1] - SIDE * 10, origin[0] + SIDE * 10, origin[1],
                                               transform=src.transform).round_offsets().round_lengths()
            out = (SIDE, SIDE) if scale20 else None
            return src.read(1, window=win, out_shape=out, resampling=res)
    return retry(go)


def read_scl_native(item, origin, epsg):
    """SCL window at native 20 m (cheap) for candidate scoring."""
    def go():
        with rasterio.Env(**ENV), rasterio.open(item.assets["scl"].href) as src:
            win = rasterio.windows.from_bounds(origin[0], origin[1] - SIDE * 10, origin[0] + SIDE * 10, origin[1],
                                               transform=src.transform).round_offsets().round_lengths()
            return src.read(1, window=win)
    return retry(go)


def tile_geometry(items, center, epsg_cache={}):
    """Return (epsg, origin) of a 30 km square near `center`, snapped to the tile's 20 m grid and kept inside the
    tile bbox (center shifted if needed)."""
    a = items[0].assets["blue"].extra_fields
    epsg = int(items[0].properties["proj:code"].split(":")[1])
    tr, (h, w) = a["proj:transform"], a["proj:shape"]  # tr = [10,0,x,0,-10,y]
    bx0, by1, bx1, by0 = tr[2], tr[5], tr[2] + 10 * w, tr[5] - 10 * h
    cx, cy = Transformer.from_crs(4326, epsg, always_xy=True).transform(center[1], center[0])
    # tile bbox edges are partial near swath edges: keep 1 km margin
    x0 = min(max(cx - 15000, bx0 + 1000), bx1 - 1000 - 30000)
    y1 = min(max(cy + 15000, by0 + 1000 + 30000), by1 - 1000)
    x0 = tr[2] + 20 * round((x0 - tr[2]) / 20)
    y1 = tr[5] - 20 * round((tr[5] - y1) / 20)
    return epsg, (float(x0), float(y1))


def group_key(it):
    p = it.properties
    return p["grid:code"], int(p["s2:product_uri"].split("_")[4][1:])  # MGRS tile, relative orbit (R019)


def pick_s2(aoi, log_):
    """Search, choose tile+orbit group and the 4 scenes. Returns scenes entry + selection log."""
    from pystac_client import Client
    cat = Client.open(S2_STAC)
    cx = aoi["center"]
    pt = {"type": "Point", "coordinates": [cx[1], cx[0]]}
    items = retry(lambda: list(cat.search(collections=["sentinel-2-l2a"], intersects=pt,
                                          datetime="2022-12-01/2026-11-01", max_items=1500).items()))
    groups = {}
    for it in items:
        groups.setdefault(group_key(it), []).append(it)
    log(f"{aoi['id']}: {len(items)} items, groups " + str({k: len(v) for k, v in groups.items()}))
    months = aoi["season_months"]
    for key, its in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        epsg, origin = tile_geometry(its, cx)
        cache = {}

        def cloud(it):  # AOI cloud + nodata from SCL
            if it.id not in cache:
                try:
                    scl = read_scl_native(it, origin, epsg)
                    cache[it.id] = tuple(float(v) for v in scl_fractions(scl))
                except Exception as e:
                    log(f"  scl fail {it.id}: {e}")
                    cache[it.id] = (1.0, 1.0)
            return cache[it.id]

        def seasonal(y):
            return sorted([i for i in its if i.datetime.year == y and i.datetime.month in months
                           and i.properties.get("eo:cloud_cover", 100) <= 40],
                          key=lambda i: i.properties.get("eo:cloud_cover", 100))[:8]

        def best(y, ref_doy=None):
            sc = []
            for it in seasonal(y):
                cl, nd = cloud(it)
                if nd > 0.01:
                    continue
                d = 0 if ref_doy is None else abs(it.datetime.timetuple().tm_yday - ref_doy)
                sc.append((cl * 100 + 0.1 * d, cl, it))
            sc = [s for s in sc if s[1] <= 0.30]
            return min(sc, key=lambda s: s[0]) if sc else None
        sel = {}
        for y1 in [aoi["years"][1]]:
            t1 = best(y1)
            if not t1:
                continue
            for y0 in (aoi["years"][0], 2024):
                t0 = best(y0, t1[2].datetime.timetuple().tm_yday)
                if t0:
                    sel = dict(t0=t0, t1=t1, y0=y0)
                    break
        if not sel:
            log(f"  group {key}: no clear pair")
            continue
        t0, t1 = sel["t0"][2], sel["t1"][2]
        taken = {t0.id, t1.id}
        cands = [i for i in its if i.id not in taken and i.datetime > t0.datetime + timedelta(days=30)
                 and 8 <= i.properties.get("eo:cloud_cover", 0) <= 85]
        scored = []
        for it in cands:
            cl, nd = cloud(it)
            if 0.15 <= cl <= 0.70 and nd <= 0.01:
                scored.append((cl, it))
        c1 = min(scored, key=lambda s: abs(s[0] - 0.30), default=None)
        rest = [s for s in scored if c1 and abs((s[1].datetime - c1[1].datetime).days) >= 20]
        c2 = min(rest, key=lambda s: abs(s[0] - 0.55), default=None)
        if not (c1 and c2):
            log(f"  group {key}: no c1/c2 ({len(scored)} cloudy candidates)")
            continue
        chosen = dict(t0=(sel["t0"][1], t0), t1=(sel["t1"][1], t1), c1=c1, c2=c2)
        dates = {}
        for k, (cl, it) in chosen.items():
            off = needs_boa_offset(it.properties)
            dates[k] = dict(item_id=it.id, datetime=it.datetime.isoformat(), aoi_cloud_scl=round(cl, 4),
                            boa_offset_applied=off)
            log(f"  {aoi['id']} {k}: {it.id} {it.datetime.date()} SCL cloud {cl:.1%} (eo {it.properties.get('eo:cloud_cover')}) "
                f"baseline {it.properties.get('s2:processing_baseline')} offset={off}")
        why = (f"group {key} (most items with a clear {sel['y0']}/{aoi['years'][1]} pair, nodata<=1%); "
               f"t0/t1 lowest SCL cloud with DOY match; c1/c2 SCL cloud nearest 30%/55% in [15,70]%")
        return dict(epsg=epsg, origin_xy=list(origin), mgrs=str(key[0]).removeprefix("MGRS-"), rel_orbit=key[1], dates=dates, s1={}), why
    raise RuntimeError(f"{aoi['id']}: no valid scene set in any group; widen date window")


def build_date(aoi_id, label, entry, scene, items_by_id):
    cp, sp = CHIPS / f"{aoi_id}_{label}.npy", CHIPS / f"{aoi_id}_{label}_scl.npy"
    if cp.exists() and sp.exists():
        return log(f"skip {cp.name}")
    it = items_by_id[entry["item_id"]]
    origin, epsg = scene["origin_xy"], scene["epsg"]
    jobs = {b: (it.assets[a].href, Resampling.bilinear if b == "B11" else Resampling.nearest, b == "B11")
            for b, a in ASSET.items()}
    jobs["SCL"] = (it.assets["scl"].href, Resampling.nearest, True)
    with ThreadPoolExecutor(6) as ex:
        futs = {b: ex.submit(read_asset, h, origin, epsg, r, s) for b, (h, r, s) in jobs.items()}
        data = {b: f.result() for b, f in futs.items()}
    off = entry["boa_offset_applied"] = needs_boa_offset(it.properties, data["B08"])
    stack = np.stack([harmonize(data[b], off) for b in BANDS])
    save_atomic(sp, tile_scl(data["SCL"].astype(np.uint8)))
    save_atomic(cp, tile_chips(stack))
    log(f"wrote {cp.name} {stack.shape} mean B04 {stack[2].mean():.0f}")


def fetch_items(ids):
    from pystac_client import Client
    cat = Client.open(S2_STAC)
    return {i.id: i for i in retry(lambda: list(cat.search(collections=["sentinel-2-l2a"], ids=ids).items()))}


# ---------- Sentinel-1 ----------
def to_db(lin: np.ndarray) -> np.ndarray:
    return (10 * np.log10(np.clip(lin, 1e-4, None))).astype(np.float16)


def build_s1(aoi_id, scene, aoi):
    import planetary_computer as pc
    from pystac_client import Client
    from shapely.geometry import box
    cat = Client.open(S1_STAC)
    epsg, o = scene["epsg"], scene["origin_xy"]
    t = Transformer.from_crs(epsg, 4326, always_xy=True)
    xs, ys = t.transform([o[0], o[0] + 30000], [o[1] - 30000, o[1]])
    area = box(xs[0], ys[0], xs[1], ys[1])
    d0, d1 = (datetime.fromisoformat(scene["dates"][k]["datetime"]).replace(tzinfo=None) for k in ("t0", "t1"))
    items = retry(lambda: list(cat.search(collections=["sentinel-1-rtc"], intersects=area.__geo_interface__,
                                          datetime=f"{d0.year - 1}-12-01/{d1.year}-12-31", max_items=800).items()))
    items = [i for i in items if "vv" in i.assets and "vh" in i.assets
             and box(*i.bbox).buffer(0).contains(area)]
    groups = {}
    for i in items:
        groups.setdefault((i.properties.get("sat:orbit_state"), i.properties.get("sat:relative_orbit")), []).append(i)
    if not groups:
        raise RuntimeError("no S1 RTC covering AOI")
    key, its = max(groups.items(), key=lambda kv: len(kv[1]))
    nearest = lambda tgt: min(its, key=lambda i: abs(i.datetime.replace(tzinfo=None) - tgt))
    mon_year = d0.year if d0.month < 7 else d0.year + 1  # first Jul-Sep after t0
    mon = [i for i in its if i.datetime.year == mon_year and i.datetime.month in (7, 8, 9)]
    pick = {"t0": nearest(d0), "t1": nearest(d1)}
    if mon:
        pick["monsoon"] = min(mon, key=lambda i: abs(i.datetime.replace(tzinfo=None) - datetime(mon_year, 8, 15)))
    log(f"{aoi_id} S1 group {key} ({len(its)} items): " + ", ".join(f"{k}={v.datetime.date()}" for k, v in pick.items()))
    ensure(S1)
    for lab, it in pick.items():
        scene["s1"][lab] = dict(item_id=it.id, datetime=it.datetime.isoformat())
        p = S1 / f"{aoi_id}_{lab}.npy"
        if p.exists():
            continue
        sit = pc.sign(it)
        bands = []
        for a in ("vv", "vh"):
            def go(href=sit.assets[a].href):
                with rasterio.Env(GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2"), rasterio.open(href) as src, \
                        WarpedVRT(src, crs=f"EPSG:{epsg}", transform=aoi_transform(o), width=SIDE, height=SIDE,
                                  resampling=Resampling.bilinear, src_nodata=src.nodata, nodata=np.nan) as vrt:
                    return vrt.read(1)
            lin = retry(go)
            bands.append(to_db(np.nan_to_num(lin, nan=0.0)))  # nodata -> clip floor (-40 dB)
        save_atomic(p, tile_chips(np.stack(bands)))
        log(f"wrote {p.name}")


# ---------- orchestration ----------
def load_aois():
    return json.loads((CONFIG / "aois.json").read_text(encoding="utf-8"))["aois"]


def dir_bytes(aoi_id):
    return sum(p.stat().st_size for d in (CHIPS, S1, LABELS) for p in d.glob(f"{aoi_id}_*") if p.is_file()) \
        + sum(p.stat().st_size for p in (LABELS.glob(f"{aoi_id}.*")))


def write_report(aois):
    scenes = json.loads((VAULT / "scenes.json").read_text(encoding="utf-8"))
    sel = REPORTS / "vault_selection.json"
    why = json.loads(sel.read_text(encoding="utf-8")) if sel.exists() else {}
    rep, total = {}, 0
    for a in aois:
        s = scenes.get(a["id"])
        if not s:
            continue
        n = sum(1 for d in DATES if (CHIPS / f"{a['id']}_{d}.npy").exists()) * NCHIP
        b = dir_bytes(a["id"])
        total += b
        rep[a["id"]] = dict(mgrs=s["mgrs"], rel_orbit=s["rel_orbit"], epsg=s["epsg"], origin_xy=s["origin_xy"],
                            scenes={d: dict(item_id=v["item_id"], date=v["datetime"][:10], aoi_cloud_pct=round(v["aoi_cloud_scl"] * 100, 2),
                                            boa_offset_applied=v["boa_offset_applied"]) for d, v in s["dates"].items()},
                            chips=n, bytes=b, s1={k: v["datetime"][:10] for k, v in s["s1"].items()},
                            selection=why.get(a["id"]))
    ensure(REPORTS)
    (REPORTS / "vault.json").write_text(json.dumps(dict(aois=rep, total_bytes=total), indent=1), encoding="utf-8")


def cmd_build(args):
    ensure(CHIPS, VAULT / "meta", LABELS)
    sp, sel = VAULT / "scenes.json", REPORTS / "vault_selection.json"
    scenes = json.loads(sp.read_text(encoding="utf-8")) if sp.exists() else {}
    why = json.loads(sel.read_text(encoding="utf-8")) if sel.exists() else {}
    ensure(REPORTS)
    aois = [a for a in load_aois() if args.aoi in (None, a["id"])]
    for a in aois:
        aid = a["id"]
        if aid not in scenes:
            scenes[aid], why[aid] = pick_s2(a, log)
            sp.write_text(json.dumps(scenes, indent=1), encoding="utf-8")
            sel.write_text(json.dumps(why, indent=1), encoding="utf-8")
        s = scenes[aid]
        (VAULT / "meta" / f"{aid}.json").write_text(
            json.dumps(tiles_meta(aid, s["epsg"], s["origin_xy"])), encoding="utf-8")
        todo = [d for d in DATES if not (CHIPS / f"{aid}_{d}.npy").exists() or not (CHIPS / f"{aid}_{d}_scl.npy").exists()]
        items = fetch_items([s["dates"][d]["item_id"] for d in todo]) if todo else {}
        for d in (("t0", "t1") if args.quick else DATES):
            build_date(aid, d, s["dates"][d], s, items)
            sp.write_text(json.dumps(scenes, indent=1), encoding="utf-8")
        if aid == "sone" or (aid == "hasdeo" and not args.quick):
            try:
                build_s1(aid, s, a)
            except Exception as e:  # hasdeo is optional; sone failure must be loud
                log(f"S1 {aid} FAILED: {e}")
                if aid == "sone":
                    raise
            sp.write_text(json.dumps(scenes, indent=1), encoding="utf-8")
    write_manifest()
    write_report(load_aois())
    log("build done")
    return 0


def cmd_extra(args):
    """Training-only captures x1,x2 (same tile+orbit+grid): cloud 20-80% in AOI, x1 = highest SCL-10 (thin cirrus)."""
    from pystac_client import Client
    cat = Client.open(S2_STAC)
    sp = VAULT / "scenes.json"
    scenes = json.loads(sp.read_text(encoding="utf-8"))
    for a in [a for a in load_aois() if args.aoi in (None, a["id"])]:
        aid, s = a["id"], scenes[a["id"]]
        if "x1" not in s["dates"]:
            cx = a["center"]
            pt = {"type": "Point", "coordinates": [cx[1], cx[0]]}
            its = retry(lambda: list(cat.search(collections=["sentinel-2-l2a"], intersects=pt,
                                                datetime="2023-01-01/2025-12-31", max_items=1500).items()))
            used = {v["item_id"] for v in s["dates"].values()}
            its = [i for i in its if group_key(i)[0] == "MGRS-" + s["mgrs"] and group_key(i)[1] == s["rel_orbit"]
                   and i.id not in used]
            # prefilter by the tile-wide cirrus property, then score the AOI window from SCL
            its = sorted(its, key=lambda i: -i.properties.get("s2:thin_cirrus_percentage", 0))[:25]
            sc = []
            for it in its:
                scl = retry(lambda: read_scl_native(it, s["origin_xy"], s["epsg"]))
                cl, nd = (float(v) for v in scl_fractions(scl))
                if 0.20 <= cl <= 0.80 and nd <= 0.01:
                    sc.append((float((scl == 10).mean()), cl, it))
            sc.sort(key=lambda t: -t[0])
            if len(sc) < 2:
                raise RuntimeError(f"{aid}: <2 extra candidates")
            x1 = sc[0]
            x2 = next((t for t in sc[1:] if abs((t[2].datetime - x1[2].datetime).days) >= 20), sc[1])
            for lab, (ci, cl, it) in (("x1", x1), ("x2", x2)):
                s["dates"][lab] = dict(item_id=it.id, datetime=it.datetime.isoformat(), aoi_cloud_scl=round(cl, 4),
                                       aoi_cirrus_scl=round(ci, 4), boa_offset_applied=False, training_only=True)
            sp.write_text(json.dumps(scenes, indent=1), encoding="utf-8")
        items = fetch_items([s["dates"][d]["item_id"] for d in ("x1", "x2")])
        for d in ("x1", "x2"):
            e = s["dates"][d]
            log(f"{aid} {d}: {e['item_id']} cloud {e['aoi_cloud_scl']:.1%} cirrus {e['aoi_cirrus_scl']:.1%}")
            build_date(aid, d, e, s, items)
            sp.write_text(json.dumps(scenes, indent=1), encoding="utf-8")
    write_manifest()
    return 0


def cmd_verify(_):
    bad = verify_manifest()
    print("vault verify:", "OK" if not bad else f"FAILED {bad[:10]}")
    return 1 if bad else 0


def cmd_pack(_):
    write_manifest()
    out = VAULT / "herald_vault.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for rel in [*vault_files(VAULT), "MANIFEST.json"]:
            z.write(VAULT / rel, rel if isinstance(rel, str) else rel.as_posix())
    print(f"packed {out} {out.stat().st_size} B")
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    ap = argparse.ArgumentParser(prog="herald vault")
    ap.add_argument("cmd", choices=["vault"])
    ap.add_argument("action", choices=["build", "verify", "pack", "manifest", "extra"])
    ap.add_argument("--aoi")
    ap.add_argument("--quick", action="store_true", help="t0,t1 only; skip hasdeo S1")
    a = ap.parse_args(argv)
    return {"build": cmd_build, "extra": cmd_extra, "verify": cmd_verify, "pack": cmd_pack,
            "manifest": lambda _: (write_manifest(), 0)[1]}[a.action](a)


if __name__ == "__main__":
    sys.exit(main(["vault", *sys.argv[1:]]))
