"""Change engine (PRD s7): transparent indices-and-rules baseline, t0 -> t1 per AOI.

Whole AOI is processed as a 2944x2944 mosaic of the 46x46 chip grid so connected
components and river buffers do not break at chip edges; results are reduced per chip.
Usage: python -m herald change [--aoi blr] [--retune]
"""
import argparse
import itertools
import json

import numpy as np
from scipy import ndimage as ndi

from . import paths

G = 46
N = G * G
C = paths.CHIP
M = G * C
CHIP_PX = C * C
INVALID_SCL = (0, 1, 3, 8, 9, 10, 11)
VALID_FRAC = 0.85
WC_IDX = {10: 0, 80: 7}   # position in wc [N,11] (WorldCover legend order)
SIZES_HA = (0.25, 0.5, 1, 2, 4)
CAVEAT = ("Indices-and-rules baseline, not a learned model. OSM landuse=construction is a sparse, "
          "incomplete weak label (precision is understated, recall is of mapped sites only). "
          "Injected patches reuse real spectra of the same scene but have no real spatial texture. "
          "Seasonal/crop and moisture change can mimic change; outputs are leads needing verification.")

# Frozen defaults. construction is overwritten by tuning on blr west half (config/change_thresholds.json).
DEFAULTS = {
    "construction": {"a_dndvi": 0.15, "b_dndbi": 0.05, "c_dbsi": 0.10, "min_px": 8, "chip_ha": 0.5,
                     "ndvi1_max": 0.35, "bsi_bare": 0.15, "osm_frac": 0.02, "tuned": False,
                     # layout detector: thin bright new lines (line-opening minus 3x3 opening on t1 visible brightness)
                     "road_r": 0.03, "road_r0": 0.015, "layout_density": 0.03, "layout_min_road_px": 15,
                     "layout_orient_share": 0.15, "building_frac": 0.4, "wet_chip": 0.10, "wet_mndwi": -0.3},
    # literature-sensible: MNDWI>0 water (Xu 2006); BSI rise 0.10; 300 m buffer = 30 px
    "sand": {"c_dbsi": 0.10, "buffer_px": 30, "min_px": 8, "wc80_chip": 0.25},
    # forest NDVI>0.5; clearing = dNDVI < -0.25 (Hansen-style loss, dry-season pair); WC tree chips relax to 0.35
    "clearing": {"forest_ndvi": 0.5, "d_ndvi": 0.25, "min_px": 8, "wc10_chip": 0.5, "wc_ndvi": 0.35},
}
CFG_PATH = paths.CONFIG / "change_thresholds.json"


# ---------------------------------------------------------------- indices
def _nd(a, b):
    s = a + b
    return np.where(np.abs(s) > 1e-6, (a - b) / np.where(np.abs(s) > 1e-6, s, 1), 0).astype(np.float32)


def indices(x):
    """x: reflectance [5,...] (B02,B03,B04,B08,B11) -> dict of ndvi, ndbi, mndwi, bsi."""
    b2, b3, b4, b8, b11 = x
    return {"ndvi": _nd(b8, b4), "ndbi": _nd(b11, b8), "mndwi": _nd(b3, b11), "bsi": _nd(b11 + b4, b8 + b2)}


def valid_mask(scl0, scl1, dilate=2):
    """Pixel valid on both dates; invalid dilated `dilate` px to drop cloud/shadow fringes."""
    bad = np.isin(scl0, INVALID_SCL) | np.isin(scl1, INVALID_SCL)
    if dilate:
        bad = ndi.binary_dilation(bad, iterations=dilate)
    return ~bad


def remove_small(mask, min_px):
    if min_px <= 1 or not mask.any():
        return mask
    lab, n = ndi.label(mask, structure=np.ones((3, 3)))
    keep = np.bincount(lab.ravel()) >= min_px
    keep[0] = False
    return keep[lab]


# ---------------------------------------------------------------- rules
def detect(kind, x0, x1, valid, thr, ctx=None):
    """Return (mask, idx0, idx1, buffer). x0,x1 reflectance [5,H,W]; ctx: optional wc chip maps."""
    i0, i1 = indices(x0), indices(x1)
    d = {k: i1[k] - i0[k] for k in i0}
    buf = None
    if kind == "construction":
        m = ((d["ndvi"] < -thr["a_dndvi"]) & ((d["ndbi"] > thr["b_dndbi"]) | (d["bsi"] > thr["c_dbsi"]))
             & (i1["mndwi"] < 0) & (i0["mndwi"] < 0) & (i1["ndvi"] < thr.get("ndvi1_max", 1.0)))
    elif kind == "sand":
        w0, w1 = i0["mndwi"] > 0, i1["mndwi"] > 0
        near = ((w0 | w1) & valid)
        buf = (ndi.distance_transform_edt(~near) <= thr["buffer_px"]) if near.any() else np.zeros_like(near)
        if ctx is not None and ctx.get("river_chip") is not None:
            buf |= ctx["river_chip"]
        m = buf & ((w0 != w1) | ((d["bsi"] > thr["c_dbsi"]) & ~w1))
    elif kind == "clearing":
        forest = i0["ndvi"] > thr["forest_ndvi"]
        if ctx is not None and ctx.get("forest_chip") is not None:
            forest |= ctx["forest_chip"] & (i0["ndvi"] > thr["wc_ndvi"])
        m = forest & (d["ndvi"] < -thr["d_ndvi"])
    else:
        raise ValueError(kind)
    if kind == "construction" and ctx:
        if ctx.get("exclude") is not None:   # OSM lake polygons: handled by the lake water check, not construction
            m &= ~ctx["exclude"]
        if ctx.get("wet_chip") is not None:  # WorldCover water/wetland chips: drop wet-at-t0 pixels
            m &= ~(ctx["wet_chip"] & (i0["mndwi"] > thr["wet_mndwi"]))
    m = remove_small(m & valid, thr["min_px"])
    return m, i0, i1, buf, d


def stages(i1, mask, thr):
    """Two-stage split of a construction mask. built: NDBI>0 and BSI below bare-soil level at t1
    (roofs/concrete); cleared: the rest (veg -> bare earthwork / layouts, also ambiguous with harvested crops)."""
    built = mask & (i1["ndbi"] > 0) & (i1["bsi"] < thr["bsi_bare"])
    return mask & ~built, built


# ---------------------------------------------------------------- mosaic helpers
def mosaic(a):
    """[N,(K,)64,64] -> [(K,)2944,2944]."""
    if a.ndim == 3:
        return a.reshape(G, G, C, C).transpose(0, 2, 1, 3).reshape(M, M)
    k = a.shape[1]
    return a.reshape(G, G, k, C, C).transpose(2, 0, 3, 1, 4).reshape(k, M, M)


def chipify(m):
    return m.reshape(G, C, G, C).transpose(0, 2, 1, 3).reshape(N, C, C)


def chip_to_px(chipmask):
    """[N] bool -> [2944,2944] bool constant over each chip."""
    return np.kron(chipmask.reshape(G, G), np.ones((C, C), bool)).astype(bool)


def load_aoi(aoi, date):
    x = np.load(paths.CHIPS / f"{aoi}_{date}.npy", mmap_mode="r")
    scl = np.load(paths.CHIPS / f"{aoi}_{date}_scl.npy", mmap_mode="r")
    return mosaic(np.asarray(x)).astype(np.float32) / 1e4, mosaic(np.asarray(scl))


def chip_stats(mask, valid, deltas):
    ch = chipify(mask)
    sev = ch.reshape(N, -1).sum(1) / CHIP_PX
    vf = chipify(valid).reshape(N, -1).mean(1)
    ok = vf >= VALID_FRAC
    sev = np.where(ok, sev, 0.0)
    stats = {k: chipify(np.where(valid, v, np.nan)).reshape(N, -1) for k, v in deltas.items()}
    with np.errstate(all="ignore"):
        means = {k: np.nanmean(v, axis=1) for k, v in stats.items()}
    return sev, vf, ok, means


# ---------------------------------------------------------------- tuning + validation
def prf(pred, lab):
    tp = int((pred & lab).sum())
    fp, fn = int((pred & ~lab).sum()), int((~pred & lab).sum())
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0,
            "f05": round(1.25 * p * r / (0.25 * p + r), 4) if p + r else 0.0,
            "tp": tp, "fp": fp, "fn": fn, "n": int(len(pred)), "n_pos": int(lab.sum())}


def tune_construction(x0, x1, valid, osm, ok_chip, thr):
    """Grid search on west half of chip columns (col < 23); returns best thr + west/east P/R at the frozen choice."""
    col = np.tile(np.arange(G), G)
    west, east = col < G // 2, col >= G // 2
    lab = osm >= thr["osm_frac"]
    best = None
    for a, b, mn in itertools.product((0.25, 0.30, 0.35), (0.0, 0.03, 0.06, 0.10), (16, 25)):   # a>=0.25: dry-season crop NDVI swing is ~0.2
        t = dict(thr, a_dndvi=a, b_dndbi=b, min_px=mn)
        m = detect("construction", x0, x1, valid, t)[0]
        ha_c = chipify(m).reshape(N, -1).sum(1) / CHIP_PX * paths.CHIP_HA
        for cha in (0.5, 1.0, 2.0):
            pred = (ha_c >= cha) & ok_chip
            s = prf(pred[west & ok_chip], lab[west & ok_chip])
            if best is None or s["f1"] > best[0]:
                best = (s["f1"], dict(t, chip_ha=cha), pred)
    _, t, pred = best
    t["tuned"] = True
    return t, {"west_tune": prf(pred[west & ok_chip], lab[west & ok_chip]),
               "east_test": prf(pred[east & ok_chip], lab[east & ok_chip])}


def _paint(x1, rng, pool, ys, xs, ha):
    side = max(2, int(round(np.sqrt(ha * 100))))
    y, x = ys, xs
    n = side * side
    patch = pool[:, rng.integers(0, pool.shape[1], n)].reshape(5, side, side)
    x1[:, y:y + side, x:x + side] = patch
    return (y, x, side)


def injected_test(kind, x0, x1, valid, thr, ctx_fn, base_sev, rng, per_size=20):
    """Paint real built/bare spectra into t1 at fully-vegetated valid chips; recall by patch size."""
    i0, i1 = indices(x0), indices(x1)
    if kind == "construction":
        pool_m = valid & (i1["ndbi"] > 0.05) & (i1["ndvi"] < 0.15) & (i1["mndwi"] < 0)
        veg = i0["ndvi"] > 0.4
        need_frac = 0.5
    else:
        pool_m = valid & (i1["ndvi"] < 0.2) & (i1["bsi"] > 0) & (i1["mndwi"] < 0)
        veg = i0["ndvi"] > thr["forest_ndvi"]
        need_frac = 0.9
    pool = x1[:, pool_m]
    if pool.shape[1] < 500:
        return {"error": "too few source pixels", "pool_px": int(pool.shape[1])}
    pool = pool[:, rng.choice(pool.shape[1], min(pool.shape[1], 200000), replace=False)]
    cv = chipify(valid).reshape(N, -1).mean(1)
    cveg = chipify(veg & valid).reshape(N, -1).mean(1)
    cand = np.flatnonzero((cv >= 0.99) & (cveg >= need_frac) & (base_sev == 0))
    res = {"n_candidate_chips": int(len(cand)), "pool_px": int(pool.shape[1]), "recall_by_size": {},
           "chip_detect_by_size": {}, "seed": 11}
    if len(cand) < per_size:
        res["error"] = "not enough fully-vegetated clean chips"
        return res
    chips_x0, chips_x1 = x0.reshape(5, G, C, G, C), x1.reshape(5, G, C, G, C)
    vegc = chipify(veg & valid)
    for ha in SIZES_HA:
        hit = chip_hit = done = 0
        for i in rng.permutation(cand):
            if done == per_size:
                break
            r, c = divmod(int(i), G)
            a0, a1 = chips_x0[:, r, :, c, :].copy(), chips_x1[:, r, :, c, :].copy()
            side = max(2, int(round(np.sqrt(ha * 100))))
            for _ in range(200):   # box must be entirely vegetated at t0
                y, x = (int(v) for v in rng.integers(2, C - side - 1, 2))
                if vegc[i, y:y + side, x:x + side].all():
                    break
            else:
                continue   # no fully vegetated box of this size in the chip: try next chip
            done += 1
            _paint(a1, rng, pool, y, x, ha)
            v = np.ones((C, C), bool)
            ctx = ctx_fn(int(i)) if ctx_fn else None
            m = detect(kind, a0, a1, v, thr, ctx)[0]
            frac = m[y:y + side, x:x + side].mean()
            hit += frac >= 0.5
            chip_hit += bool(m.any())
        res["recall_by_size"][str(ha)] = round(hit / max(done, 1), 3)
        res["chip_detect_by_size"][str(ha)] = round(chip_hit / max(done, 1), 3)
        res.setdefault("n_trials", {})[str(ha)] = done
    return res


# ---------------------------------------------------------------- imagery
def write_images(aoi, dates, mask_px):
    from PIL import Image
    out = paths.WEB_DATA / "img"
    paths.ensure(out)
    mos = {}
    for d in dates:
        if (paths.CHIPS / f"{aoi}_{d}.npy").exists():
            x = np.load(paths.CHIPS / f"{aoi}_{d}.npy", mmap_mode="r")
            mos[d] = mosaic(np.asarray(x[:, [2, 1, 0]])).astype(np.float32) / 1e4
    ref = np.concatenate([mos[d][:, ::4, ::4].reshape(3, -1) for d in ("t0", "t1") if d in mos], axis=1)
    ref = ref[:, ref.max(0) > 0]
    lo = np.percentile(ref, 2, axis=1)[:, None, None]
    hi = np.percentile(ref, 98, axis=1)[:, None, None]
    for d, a in mos.items():
        img = (np.clip((a - lo) / (hi - lo), 0, 1) ** (1 / 1.6) * 255).astype(np.uint8).transpose(1, 2, 0)
        sz = 1472 if d in ("t0", "t1") else 736
        Image.fromarray(img).resize((sz, sz), Image.LANCZOS).save(out / f"{aoi}_{d}.jpg", quality=82)
    half = mask_px.reshape(M // 2, 2, M // 2, 2).any(axis=(1, 3))
    rgba = np.zeros((M // 2, M // 2, 4), np.uint8)
    rgba[half] = (255, 40, 40, 200)
    Image.fromarray(rgba).save(out / f"{aoi}_change.png")
    return lo.ravel(), hi.ravel()


def qa_grid(aoi, kind, recs, x0c, x1c, maskc, lo, hi, top=12):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    sel = [r for r in sorted(recs, key=lambda r: -r["ha"]) if r["valid"] and r["ha"] > 0][:top]
    if not sel:
        return
    rows = (len(sel) + 1) // 2
    fig, axs = plt.subplots(rows, 6, figsize=(12, 2.1 * rows), squeeze=False)
    for ax in axs.ravel():
        ax.axis("off")
    rgb = lambda x: np.clip((x[[2, 1, 0]] - lo[:, None, None]) / (hi - lo)[:, None, None], 0, 1).transpose(1, 2, 0) ** (1 / 1.6)
    for k, r in enumerate(sel):
        i, row, c0 = r["i"], k // 2, (k % 2) * 3
        for j, (img, t) in enumerate(((rgb(x0c[i] / 1e4), "t0"), (rgb(x1c[i] / 1e4), "t1"), (maskc[i], f"#{i} {r['ha']:.1f} ha"))):
            axs[row, c0 + j].imshow(img, cmap="gray" if j == 2 else None, interpolation="nearest")
            axs[row, c0 + j].set_title(t, fontsize=7)
    fig.suptitle(f"{aoi} ({kind}) top {len(sel)} tiles by changed area: t0 | t1 | mask", fontsize=9)
    fig.tight_layout()
    paths.ensure(paths.REPORTS / "qa")
    fig.savefig(paths.REPORTS / "qa" / f"change_{aoi}.png", dpi=110)
    plt.close(fig)



# ---------------------------------------------------------------- Track A: wards, survey, anchors
WARDS = paths.CONFIG / "ref" / "bbmp_wards.geojson"
PUBLISHED = {"pp_per_yr": 0.5, "src": "Landsat study of Bengaluru agglomeration: built-up 12.6% (2000) -> 22.8% (2020)"}


def _geo(aoi):
    from pyproj import Transformer
    sc = json.loads((paths.VAULT / "scenes.json").read_text(encoding="utf-8"))[aoi]
    x0, y0 = sc["origin_xy"]
    return sc, x0, y0, Transformer.from_crs(4326, sc["epsg"], always_xy=True), Transformer.from_crs(sc["epsg"], 4326, always_xy=True)


def rasterize_wards(aoi):
    """-> (ward index raster [M,M] uint16, 0 = outside any ward; ward props list indexed from 1)."""
    from rasterio import features
    from rasterio.transform import from_origin
    from shapely.geometry import box, shape
    from shapely.ops import transform
    sc, x0, y0, fwd, _ = _geo(aoi)
    gj = json.loads(WARDS.read_text(encoding="utf-8"))
    aoi_box = box(x0, y0 - M * 10, x0 + M * 10, y0)
    shapes, props = [], []
    for f in gj["features"]:
        g = transform(fwd.transform, shape(f["geometry"]))
        if g.intersects(aoi_box):
            props.append({"id": f["properties"]["KGISWardNo"], "name": f["properties"]["KGISWardName"]})
            shapes.append((g, len(props)))
    r = features.rasterize(shapes, out_shape=(M, M), transform=from_origin(x0, y0, 10, 10), fill=0, dtype="uint16") if shapes \
        else np.zeros((M, M), np.uint16)
    return r, props


def ward_raster(aoi):
    wr, props = rasterize_wards(aoi)
    props = props + [{"id": "peri", "name": "Outside BBMP (peri-urban)"}]
    return np.where(wr == 0, len(props), wr).astype(np.int64), props


def survey(aoi, thr, i0, i1, valid, ok_px, mask, cleared, built, wr, props, cats):
    sc, x0, y0, _, inv = _geo(aoi)
    t0, t1 = sc["dates"]["t0"]["datetime"], sc["dates"]["t1"]["datetime"]
    from datetime import datetime
    yrs = (datetime.fromisoformat(t1) - datetime.fromisoformat(t0)).days / 365.25
    K = len(props) + 1
    px_ha = 0.01
    ok = valid & ok_px
    b0 = (i0["ndbi"] > 0) & (i0["ndvi"] < 0.2) & ok
    b1 = (i1["ndbi"] > 0) & (i1["ndvi"] < 0.2) & ok
    coherent = remove_small(built, 25)
    cnt = lambda a: np.bincount(wr[a], minlength=K)
    n_b0, n_new, n_clr, n_coh, n_val = cnt(b0), cnt(built), cnt(cleared), cnt(coherent & built), cnt(ok)
    n_lay, n_bld = cnt(cats["new_layout"]), cnt(cats["building_construction"])
    ys, xs = np.indices((M, M))
    cy = np.bincount(wr[mask], weights=ys[mask], minlength=K) / np.maximum(cnt(mask), 1)
    cx = np.bincount(wr[mask], weights=xs[mask], minlength=K) / np.maximum(cnt(mask), 1)
    tile_id = (ys // C) * G + (xs // C)
    pair = np.bincount(wr[built] * N + tile_id[built], minlength=K * N).reshape(K, N)
    rate = json.loads((paths.CONFIG / "value.json").read_text(encoding="utf-8"))["params"]["rupees_per_ha"]
    rate_a, rate_src = rate["value"]["A"], rate["source"]
    rows = []
    for k in range(1, K):
        if n_val[k] == 0:
            continue
        lon, lat = inv.transform(x0 + (cx[k] + .5) * 10, y0 - (cy[k] + .5) * 10)
        new_ha, conf = n_new[k] * px_ha, (n_coh[k] / n_new[k] if n_new[k] else 0.0)
        rows.append({"ward_id": props[k - 1]["id"], "ward": props[k - 1]["name"], "valid_ha": round(n_val[k] * px_ha, 1),
                     "built_t0_ha": round(n_b0[k] * px_ha, 1), "new_built_ha": round(new_ha, 2),
                     "cleared_ha": round(n_clr[k] * px_ha, 2),
                     "new_layout_ha": round(n_lay[k] * px_ha, 2), "building_construction_ha": round(n_bld[k] * px_ha, 2),
                     "growth_pct": round(100 * new_ha / (n_b0[k] * px_ha), 2) if n_b0[k] else None,
                     "ha_per_yr": round(new_ha / yrs, 2), "confidence": round(conf, 3),
                     "rupees_expected": round(new_ha * rate_a * conf), "hotspot": [round(lat, 5), round(lon, 5)],
                     "top_tiles": [int(t) for t in np.argsort(-pair[k])[:3] if pair[k][t] > 0]})
    rows.sort(key=lambda r: -r["rupees_expected"])
    nb0, nb1, nv = int(b0.sum()), int(b1.sum()), int(ok.sum())
    f0, f1 = nb0 / nv, nb1 / nv
    aoi_sum = {"years": round(yrs, 3), "new_built_ha": round(float(built.sum()) * px_ha, 1),
               "cleared_ha": round(float(cleared.sum()) * px_ha, 1),
               "ha_by_category": {k: round(float(v.sum()) * px_ha, 1) for k, v in cats.items()},
               "new_built_ha_per_yr": round(float(built.sum()) * px_ha / yrs, 1),
               "built_frac_t0": round(f0, 4), "built_frac_t1": round(f1, 4),
               "built_pp_per_yr": round(100 * (f1 - f0) / yrs, 3), "published": PUBLISHED,
               "growth_caveat": "Built proxy is NDBI>0 & NDVI<0.2 at 10 m (includes bare/fallow soil); extent is a 30 km "
                                "peri-urban box, not the agglomeration; published figure is a 20-year Landsat average. "
                                "Order-of-magnitude sanity only."}
    out = {"aoi": aoi, "dates": [t0, t1], "rupees_per_ha_A": rate_a, "rupees_source": rate_src,
           "rupees_note": "assumption; expected = new_built_ha x rupees_per_ha x confidence",
           "confidence_def": "share of ward new-built px in connected components >= 25 px (0.25 ha); spatial-coherence "
                             "heuristic, not a calibrated probability",
           "built_t0_def": "NDBI>0 and NDVI<0.2 at t0 (proxy)", "aoi_summary": aoi_sum, "wards_ranked": rows[:15],
           "n_wards_with_data": len(rows)}
    (paths.REPORTS / f"survey_{aoi}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    return aoi_sum



ACRE = 4046.856
TIERS = ((100, 30), (25, 24), (10, 12), (1, 6), (0.1, 3))   # (min acres, buffer m): KTCDA Act 2025 tiers


def lake_buffer_m(area_m2):
    ac = area_m2 / ACRE
    return next((b for a, b in TIERS if ac >= a), 0)


def fetch_lakes(aoi, cache_path=None):
    """OSM natural=water polygons for the AOI bbox (cached once). Returns [{name, geom(UTM), area_m2}]."""
    import time
    import requests
    from shapely.geometry import LineString, Polygon
    from shapely.ops import linemerge, polygonize, transform
    sc, x0, y0, fwd, inv = _geo(aoi)
    cache = cache_path or paths.LABELS / f"osm_lakes_{aoi}.json"
    if not cache.exists() or '"waterway"' not in cache.read_text(encoding="utf-8"):   # refetch if drains missing
        w, n = inv.transform(x0, y0)
        e, s_ = inv.transform(x0 + M * 10, y0 - M * 10)
        bb = f"{s_},{w},{n},{e}"
        q = (f'[out:json][timeout:180];(way["natural"="water"]({bb});relation["natural"="water"]({bb});'
             f'way["waterway"~"^(drain|canal|stream|ditch)$"]({bb}););out geom;')
        for k in range(6):
            try:
                r = requests.post(("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")[k % 2],
                                  data={"data": q}, timeout=240, headers={"User-Agent": "herald-hackathon/0.1"})
                r.raise_for_status()
                cache.write_text(json.dumps(r.json()), encoding="utf-8")
                break
            except Exception as ex:
                print("overpass failed:", str(ex)[:80])
                time.sleep(5 * (k + 1))
        else:
            return None
    lakes, drains = [], []
    for el in json.loads(cache.read_text(encoding="utf-8"))["elements"]:
        tg = el.get("tags", {})
        if tg.get("waterway") in ("drain", "canal", "stream", "ditch") and tg.get("natural") != "water":
            if len(el.get("geometry", [])) >= 2:
                drains.append(transform(fwd.transform, LineString([(g["lon"], g["lat"]) for g in el["geometry"]])))
            continue
        if tg.get("water") in ("river", "canal", "stream", "stream_pool", "drain", "ditch", "wastewater", "basin", "fountain", "moat"):
            continue
        polys = []
        if el["type"] == "way" and len(el.get("geometry", [])) >= 4:
            pts = [(g["lon"], g["lat"]) for g in el["geometry"]]
            if pts[0] == pts[-1]:
                polys.append(Polygon(pts))
        elif el["type"] == "relation":   # shortcut: outer rings only, holes ignored
            lines = [LineString([(g["lon"], g["lat"]) for g in m["geometry"]]) for m in el.get("members", [])
                     if m.get("role") == "outer" and len(m.get("geometry", [])) >= 2]
            if lines:
                polys += list(polygonize(linemerge(lines)))
        for pg in polys:
            g = transform(fwd.transform, pg.buffer(0))
            if not g.is_empty:
                lakes.append({"id": el["id"], "name": tg.get("name"), "geom": g, "area_m2": g.area})
    return lakes, drains


def drain_mask(aoi, drains, dist_m=50):
    """Pixels within dist_m of an OSM drain/canal/stream/ditch line (proximity context only)."""
    from rasterio import features
    from rasterio.transform import from_origin
    from shapely.ops import unary_union
    _, x0, y0, _, _ = _geo(aoi)
    if not drains:
        return np.zeros((M, M), bool)
    g = unary_union(drains).buffer(dist_m)
    return features.rasterize([(g, 1)], out_shape=(M, M), transform=from_origin(x0, y0, 10, 10), fill=0, dtype="uint8",
                              all_touched=True).astype(bool)


def buffer_flags(aoi, lakes, changed):
    """Flag changed px inside the tiered buffer ring (water body excluded). Possible encroachment only."""
    from rasterio import features
    from rasterio.transform import from_origin
    from shapely.geometry import Point
    _, x0, y0, fwd, inv = _geo(aoi)
    tr = from_origin(x0, y0, 10, 10)
    shp, meta = [], []
    for lk in lakes or []:
        w = lake_buffer_m(lk["area_m2"])
        if w:
            ring = lk["geom"].buffer(w).difference(lk["geom"])
            if not ring.is_empty:
                shp.append((ring, len(meta) + 1))
                meta.append((lk, w))
    lab = features.rasterize(shp, out_shape=(M, M), transform=tr, fill=0, dtype="int32", all_touched=True) if shp \
        else np.zeros((M, M), np.int32)
    flagged = changed & (lab > 0)
    ys, xs = np.nonzero(flagged)
    per = {}
    for y, x in zip(ys, xs):
        lk, w = meta[lab[y, x] - 1]
        px, py = x0 + (x + .5) * 10, y0 - (y + .5) * 10
        d = lk["geom"].distance(Point(px, py))
        e = per.setdefault(int(lab[y, x]), {"name": lk["name"], "lake_acres": round(lk["area_m2"] / ACRE, 1), "buffer_m": w,
                                            "px": 0, "dmin": 1e9, "xy": None})
        e["px"] += 1
        if d < e["dmin"]:
            e["dmin"], e["xy"] = d, (px, py)
    out = []
    for e in sorted(per.values(), key=lambda e: -e["px"]):
        lon, lat = inv.transform(*e["xy"])
        out.append({"label": "possible buffer encroachment - verify on ground", "lake": e["name"], "lake_acres": e["lake_acres"],
                    "buffer_m": e["buffer_m"], "ha": round(e["px"] * 0.01, 2),
                    "min_dist_to_water_m": round(e["dmin"]), "lat": round(lat, 5), "lon": round(lon, 5)})
    return lab > 0, out, {"n_lakes_osm": len(lakes or []), "n_lakes_buffered": len(meta)}


STAGES = ("veg", "cleared", "built")
CATS = ("new_layout", "building_construction", "agri_ambiguous", "lake_filling_lead")


def stage_maps(aoi, d, thr):
    """Per-pixel class at date d: [3,M,M] bool (veg, cleared, built) + valid (SCL clear, not water)."""
    x, scl = load_aoi(aoi, d)
    v = ~ndi.binary_dilation(np.isin(scl, INVALID_SCL), iterations=2)
    i = indices(x)
    v &= i["mndwi"] <= 0
    veg = i["ndvi"] >= thr["ndvi1_max"]
    bu = (i["ndbi"] > 0) & (i["bsi"] < thr["bsi_bare"]) & ~veg
    return np.stack([veg & v, ~veg & ~bu & v, bu & v]), v


def lines(L=7):
    e = np.eye(L, dtype=bool)
    h = np.zeros((L, L), bool)
    h[L // 2, :] = True
    return [h, e, h.T.copy(), e[::-1].copy()]   # 0, 45, 90, 135 degrees


def roadness(x):
    """Thin bright linear structure: max over 4 line openings minus a 3x3 opening, on visible brightness.
    Returns (roadness, orientation index). Layout roads are thin and bright; crop furrows are low contrast."""
    b = x[:3].mean(0)
    ops = np.stack([ndi.grey_opening(b, footprint=f) for f in lines()])
    return ops.max(0) - ndi.grey_opening(b, size=(3, 3)), ops.argmax(0)


def lake_water_check(aoi, lakes, i0, i1, ok, thr, rain_note, road):
    """Per OSM lake: water ha (MNDWI>0) at t0 vs t1 and what replaced lost water at t1. Lead = bare/built >= 0.2 ha."""
    from rasterio import features
    from rasterio.transform import from_origin
    _, x0, y0, _, inv = _geo(aoi)
    lab = features.rasterize([(l["geom"], k + 1) for k, l in enumerate(lakes)], out_shape=(M, M),
                             transform=from_origin(x0, y0, 10, 10), fill=0, dtype="int32")
    K = len(lakes) + 1
    w0, w1 = (i0["mndwi"] > 0) & ok, (i1["mndwi"] > 0) & ok
    lost = w0 & ~w1 & (lab > 0)
    veg = i1["ndvi"] >= thr["ndvi1_max"]
    built = (i1["ndbi"] > 0) & (i1["bsi"] < thr["bsi_bare"]) & ~veg
    bare = ~veg & ~built
    cnt = lambda m: np.bincount(lab[m], minlength=K) * 0.01
    ys, xs = np.indices((M, M))
    nb = lost & (bare | built)
    nline = np.bincount(lab[nb & road], minlength=K)
    c = np.maximum(np.bincount(lab[nb], minlength=K), 1)
    cy, cx = np.bincount(lab[nb], weights=ys[nb], minlength=K) / c, np.bincount(lab[nb], weights=xs[nb], minlength=K) / c
    a0, a1, lv, lb, lt = cnt(w0 & (lab > 0)), cnt(w1 & (lab > 0)), cnt(lost & veg), cnt(lost & bare), cnt(lost & built)
    out = []
    for k, lk in enumerate(lakes, 1):
        if a0[k] < 0.2 and lb[k] + lt[k] < 0.2:
            continue
        lon, lat = inv.transform(x0 + (cx[k] + .5) * 10, y0 - (cy[k] + .5) * 10)
        out.append({"osm_id": lk["id"], "lake": lk["name"] or f"unnamed (osm {lk['id']})", "lake_acres": round(lk["area_m2"] / ACRE, 1),
                    "water_t0_ha": round(a0[k], 2), "water_t1_ha": round(a1[k], 2),
                    "lost_to_veg_ha": round(lv[k], 2), "lost_to_bare_ha": round(lb[k], 2), "lost_to_built_ha": round(lt[k], 2),
                    "new_line_px": int(nline[k]),
                    "lake_filling_lead": bool(lb[k] + lt[k] >= 0.2 and nline[k] >= thr["layout_min_road_px"]), "lat": round(lat, 5), "lon": round(lon, 5)})
    out.sort(key=lambda r: -(r["lost_to_bare_ha"] + r["lost_to_built_ha"]))
    return out, {"rule": "lake_filling_lead = water at t0 (MNDWI>0) lost at t1, replaced by bare/built >= 0.2 ha AND >= %d new thin bright line px (roads) on the replaced area; bare-only loss is dry-season recession (first audit: 0/10 correct without the line test)" % thr["layout_min_road_px"], "caveat": rain_note}


RAIN_NOTE = ("Both dates are February (dry season) but rainfall differs between years; a drying tank exposes bare bed, "
             "so a lead is not proof of filling. Verify on ground.")


def site_ledger(aoi, thr, mask, cleared, built, road_all, o1, wr, props, wc, ring, ring_hits, drain, drain_stats,
                lake_leads, min_px=20, top=200):
    from datetime import datetime
    sc, gx, gy, _, inv = _geo(aoi)
    lab, n = ndi.label(mask, structure=np.ones((3, 3)))
    idx = np.arange(1, n + 1)
    size = ndi.sum(mask, lab, idx)
    keep = idx[size >= min_px]
    sz = size[keep - 1]
    road = road_all & mask
    rn = ndi.sum(road, lab, keep)
    ori = np.stack([ndi.sum(road & (o1 == k), lab, keep) for k in range(4)])
    bn = ndi.sum(built, lab, keep)
    ring_n, drain_n = ndi.sum(ring, lab, keep), ndi.sum(drain, lab, keep)
    com = np.array(ndi.center_of_mass(mask, lab, keep)).reshape(-1, 2)
    order = sorted((d for d in ("c1", "t1", "c2") if (paths.CHIPS / f"{aoi}_{d}.npy").exists()),
                   key=lambda d: sc["dates"][d]["datetime"])
    frac = {}
    for d in order:
        st, v = stage_maps(aoi, d, thr)
        frac[d] = {"n": ndi.sum(v, lab, keep), **{s_: ndi.sum(st[k], lab, keep) for k, s_ in enumerate(STAGES)}}
    cats = {k: np.zeros((M, M), bool) for k in CATS[:3]}
    cat_of = np.zeros(n + 1, np.int8)
    sites = []
    for j, sid in enumerate(keep):
        dens = rn[j] / sz[j]
        n_or = int((ori[:, j] >= thr["layout_orient_share"] * max(rn[j], 1)).sum())
        layout = bool(rn[j] >= thr["layout_min_road_px"] and dens >= thr["layout_density"] and n_or >= 2)
        bfrac = bn[j] / sz[j]
        cat = "new_layout" if layout else "building_construction" if bfrac >= thr["building_frac"] else "agri_ambiguous"
        cat_of[sid] = CATS.index(cat) + 1
        stg = {}
        for d in order:
            f = frac[d]
            stg[d] = max(STAGES, key=lambda s_: f[s_][j]) if f["n"][j] >= 0.5 * sz[j] else "no_data"
        cy, cx = com[j]
        lon, lat = inv.transform(gx + (cx + .5) * 10, gy - (cy + .5) * 10)
        w = int(wr[min(int(round(cy)), M - 1), min(int(round(cx)), M - 1)])
        sites.append({"site": int(sid), "category": cat, "ha": round(sz[j] * 0.01, 2), "ward": props[w - 1]["name"],
                      "lat": round(lat, 5), "lon": round(lon, 5), "built_frac": round(float(bfrac), 2),
                      "road_density": round(float(dens), 3), "n_orientations": n_or,
                      "cropland_chip": round(float(wc[min(int(cy) // C, G - 1) * G + min(int(cx) // C, G - 1), 3]), 2),
                      "buffer_flag": bool(ring_n[j] > 0), "near_drain": bool(drain_n[j] > 0),
                      "stage_info": stg, "confidence": None})
    for k in cats:
        cats[k] = (cat_of[lab] == CATS.index(k) + 1) & mask
    # ranked lead list: lakes first, then buffer-flagged sites, then new_layout, building, agri
    tier = lambda r: 1 if r["buffer_flag"] else {"new_layout": 2, "building_construction": 2}.get(r["category"], 4)
    leads = [{"category": "lake_filling_lead", "tier": 0, "ha": round(l["lost_to_bare_ha"] + l["lost_to_built_ha"], 2),
              "ward": None, "buffer_flag": False, **l} for l in lake_leads if l["lake_filling_lead"]]
    for r in sites:
        r["tier"] = tier(r)
    sites.sort(key=lambda r: (tier(r), -r["ha"]))
    ranked = leads + sites
    for k, r in enumerate(ranked):
        r["rank"] = k + 1
    cnt = {}
    for r in ranked:
        c = cnt.setdefault(r["category"], {"n": 0, "ha": 0.0})
        c["n"] += 1
        c["ha"] = round(c["ha"] + r["ha"], 2)
    out = {"aoi": aoi, "min_site_ha": min_px * 0.01, "n_sites": len(sites), "category_counts": cnt,
           "n_buffer_flagged_sites": sum(r["buffer_flag"] for r in sites), "n_near_drain_sites": sum(r["near_drain"] for r in sites),
           "buffer_flags": ring_hits[:30], "drain": drain_stats,
           "category_def": {"new_layout": "changed site with >= %d new thin-bright-line px, density >= %s of site px and >= 2 orientations "
                            "(each >= %s of line px)" % (thr["layout_min_road_px"], thr["layout_density"], thr["layout_orient_share"]),
                            "building_construction": "not a layout; built-stage px (NDBI>0, BSI<0.15) >= %s of site" % thr["building_frac"],
                            "lake_filling_lead": "OSM lake water lost at t0->t1 and replaced by bare/built >= 0.2 ha (see caveat)",
                            "agri_ambiguous": "cleared, no road grid: possibly harvested/fallow field or other earthwork"},
           "tier_def": "0 lake_filling_lead, 1 buffer-flagged site, 2 new_layout, 3 building_construction, 4 agri_ambiguous; ha desc "
                       "within tier. Buffer/drain flags are 'possible, verify on ground'.",
           "confidence_def": "per-category precision from reports/audit_blr.json (reviewer visual audit, not field-verified); null if no audit",
           "stage_info_note": "stage at c1/t1/c2 is informational only; c1 is often cloud/no_data and c2 is a 2026 monsoon scene",
           "rainfall_caveat": RAIN_NOTE, "sites": ranked[:top]}
    return out, cats, ranked


def audit_sample(ranked, seed=11):
    """Stratified audit sample: 20 new_layout, 15 building_construction, up to 10 lake leads, 15 agri_ambiguous."""
    out, main_rng = [], np.random.default_rng(seed)
    for n, (cat, k) in enumerate((("new_layout", 20), ("building_construction", 15), ("lake_filling_lead", 10), ("agri_ambiguous", 15))):
        rng = main_rng if n < 2 else np.random.default_rng(seed + n)   # independent streams: lake rule changes don't reshuffle others
        pool = [r for r in ranked if r["category"] == cat]
        out += [pool[i] for i in sorted(rng.choice(len(pool), min(k, len(pool)), replace=False))]
    return out


def audit_grids(aoi, sample, mask, per_png=15, half=32):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    _, gx, gy, fwd, _ = _geo(aoi)
    x0 = np.load(paths.CHIPS / f"{aoi}_t0.npy", mmap_mode="r")
    x1 = np.load(paths.CHIPS / f"{aoi}_t1.npy", mmap_mode="r")
    m0, m1 = mosaic(np.asarray(x0[:, [2, 1, 0]])).astype(np.float32) / 1e4, mosaic(np.asarray(x1[:, [2, 1, 0]])).astype(np.float32) / 1e4
    hi = np.percentile(m1[:, ::8, ::8], 98)
    paths.ensure(paths.REPORTS / "qa")
    for g in range(0, len(sample), per_png):
        chunk = sample[g:g + per_png]
        fig, axs = plt.subplots(5, 6, figsize=(14, 12))
        for ax in axs.ravel():
            ax.axis("off")
        for k, r in enumerate(chunk):
            px, py = fwd.transform(r["lon"], r["lat"])
            c, rr = int((px - gx) / 10), int((gy - py) / 10)
            ys, xs = slice(max(rr - half, 0), rr + half), slice(max(c - half, 0), c + half)
            for j, m in enumerate((m0, m1)):
                ax = axs[k // 3, (k % 3) * 2 + j]
                ax.imshow(np.clip(m[:, ys, xs].transpose(1, 2, 0) / hi, 0, 1) ** (1 / 1.6), interpolation="nearest")
                if j:
                    ax.contour(mask[ys, xs], [0.5], colors="yellow", linewidths=0.6)
                ax.set_title(f"{'t0' if j == 0 else 't1'} {r['audit_id']} {r['category'][:8]} {r['ha']:.1f}ha", fontsize=7)
        fig.tight_layout()
        fig.savefig(paths.REPORTS / "qa" / f"audit_{aoi}_{g // per_png + 1}.png", dpi=70)
        plt.close(fig)


def apply_audit(aoi):
    """Write per-category audit precision into sites_{aoi}.json as `confidence` (if reports/audit_{aoi}.json exists)."""
    ap, sp = paths.REPORTS / f"audit_{aoi}.json", paths.REPORTS / f"sites_{aoi}.json"
    if not (ap.exists() and sp.exists()):
        return
    prec = {c: v["precision"] for c, v in json.loads(ap.read_text(encoding="utf-8"))["per_category"].items()}
    d = json.loads(sp.read_text(encoding="utf-8"))
    for r in d["sites"]:
        r["confidence"] = prec.get(r["category"])
    # a category with audit precision < 0.1 is demoted to the end of the ranked list
    d["sites"].sort(key=lambda r: ((r["confidence"] or 0) < 0.1, r["rank"]))
    for k, r in enumerate(d["sites"]):
        r["rank"] = k + 1
    d["demoted_categories"] = [c for c, p_ in prec.items() if p_ < 0.1]
    sp.write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")


# ---------------------------------------------------------------- driver
def run_aoi(aoi, kind, cfg, retune=False):
    lab = np.load(paths.LABELS / f"{aoi}.npz")
    x0, s0 = load_aoi(aoi, "t0")
    x1, s1 = load_aoi(aoi, "t1")
    valid = valid_mask(s0, s1)
    wc = lab["wc"]
    ctx = {"river_chip": chip_to_px(wc[:, WC_IDX[80]] >= cfg["sand"]["wc80_chip"]) if kind == "sand" else None,
           "forest_chip": chip_to_px(wc[:, WC_IDX[10]] >= cfg["clearing"]["wc10_chip"]) if kind == "clearing" else None}
    thr = cfg[kind]
    val = {"caveat": CAVEAT}
    if kind == "construction":
        lk = fetch_lakes(aoi)
        lakes, drains = lk if lk else ([], [])
        from rasterio import features
        from rasterio.transform import from_origin
        _, gx, gy, _, _ = _geo(aoi)
        ctx["exclude"] = features.rasterize([(l["geom"], 1) for l in lakes], out_shape=(M, M),
                                            transform=from_origin(gx, gy, 10, 10), fill=0, dtype="uint8").astype(bool) if lakes \
            else None
        ctx["wet_chip"] = chip_to_px(wc[:, WC_IDX[80]] + wc[:, 8] >= thr["wet_chip"])
    if kind == "construction":
        vf = chipify(valid).reshape(N, -1).mean(1)
        osm = lab["osm_constr"]
        if retune or not thr.get("tuned"):
            thr, pr = tune_construction(x0, x1, valid, osm, vf >= VALID_FRAC, thr)
            cfg[kind] = thr
            CFG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
            val["tuning"] = "grid on west half (cols<23), chip F1 vs OSM, grid limited to a>=0.25 and min_px>=16 (prior: seasonal crop swing), frozen"
        else:
            pr = None
    mask, i0, i1, buf, d = detect(kind, x0, x1, valid, thr, ctx)
    deltas = {"dndvi": d["ndvi"], "dndbi": d["ndbi"], "dmndwi": d["mndwi"], "dbsi": d["bsi"]}
    sev, vf, ok, means = chip_stats(mask, valid, deltas)
    ha = sev * paths.CHIP_HA
    okpx = chip_to_px(ok)
    mask = mask & okpx
    cmask = chipify(mask)
    if kind == "construction":
        cleared, built = stages(i1, mask, thr)
        ha_cl = chipify(cleared).reshape(N, -1).sum(1) * 0.01
        ha_bu = chipify(built).reshape(N, -1).sum(1) * 0.01
    recs = []
    s1x = {}
    if kind == "sand":
        for lbl in ("t0", "t1", "monsoon"):
            f = paths.S1 / f"{aoi}_{lbl}.npy"
            if f.exists():
                s1x[lbl] = np.load(f).astype(np.float32)
    s1ok = "t0" in s1x and "t1" in s1x
    bufc = chipify(buf) if buf is not None else None
    for i in range(N):
        r = {"i": i, "kind": kind, "sev": round(float(sev[i]), 5), "ha": round(float(ha[i]), 3), "valid": bool(ok[i]),
             "valid_frac": round(float(vf[i]), 3)}
        for k, v in means.items():
            r[k] = None if np.isnan(v[i]) else round(float(v[i]), 4)
        if s1ok and ok[i]:
            dv = s1x["t1"][i] - s1x["t0"][i]
            cm = cmask[i]
            for ch, nm in ((0, "vv"), (1, "vh")):
                r[f"s1_d{nm}"] = round(float(np.nanmean(dv[ch][cm])), 3) if cm.any() else None
                r[f"s1_d{nm}_buffer"] = round(float(np.nanmean(dv[ch][bufc[i]])), 3) if bufc[i].any() else None
            if "monsoon" in s1x:
                mv = np.abs(s1x["monsoon"][i, 0] - s1x["t0"][i, 0])
                r["monsoon_activity"] = round(float(np.nanmean(mv[bufc[i]])), 3) if bufc[i].any() else None
        if kind == "construction":
            r["ha_cleared"], r["ha_built"] = round(float(ha_cl[i]), 3), round(float(ha_bu[i]), 3)
            r["cropland"] = round(float(wc[i, 3]), 3)
        recs.append(r)
    # validation
    base_sev = np.where(ok, sev, 1.0)
    rng = np.random.default_rng(11)
    if kind != "sand":
        def cfn(i):
            w = wc[i]
            return {"river_chip": None, "forest_chip": np.full((C, C), bool(w[0] >= cfg["clearing"]["wc10_chip"]))
                    } if kind == "clearing" else None
        val["injected"] = injected_test(kind, x0, x1, valid, thr, cfn, base_sev, rng)
    else:
        val["injected"] = {"note": "not run for sand: no pixel-level ground truth; see visual QA and S1 corroboration"}
    if kind == "construction":
        col = np.tile(np.arange(G), G)
        lab_pos = osm >= thr["osm_frac"]
        pred = (ha >= thr["chip_ha"]) & ok
        val["osm"] = {"rule": f"chip positive if osm_constr >= {thr['osm_frac']}; predicted if ha >= {thr['chip_ha']} and valid",
                      "west_tune": prf(pred[(col < G // 2) & ok], lab_pos[(col < G // 2) & ok]),
                      "east_test": prf(pred[(col >= G // 2) & ok], lab_pos[(col >= G // 2) & ok]),
                      "precision": None, "recall": None, "caveat": CAVEAT}
        e = val["osm"]["east_test"]
        val["osm"]["precision"], val["osm"]["recall"] = e["precision"], e["recall"]
        print(f"[{aoi}] OSM east test P={e['precision']} R={e['recall']} (n_pos={e['n_pos']})")
    if kind == "sand" and s1ok:
        ch = np.array([r.get("s1_dvv") is not None for r in recs])
        val["s1_corroboration"] = {"n_tiles_with_changed_px_and_s1": int(ch.sum()),
                                   "note": "reported per tile, not used as a gate"}
    if kind == "construction":
        wr, props = ward_raster(aoi)
        ring, hits, lk_meta = buffer_flags(aoi, lakes, cleared | built)
        dm = drain_mask(aoi, drains)
        drain_stats = {"n_osm_drain_lines": len(drains), "near_drain_ha": round(float(((cleared | built) & dm).sum()) * 0.01, 1),
                       "dist_m": 50, "note": "proximity context flag only"}
        val["buffer_encroachment"] = {"rule": "KTCDA 2025 tiers by lake acres: <0.1 none, 0.1-1: 3 m, 1-10: 6 m, 10-25: 12 m, "
                                      "25-100: 24 m, >100: 30 m; 10 m pixels are coarse vs the buffer", **lk_meta,
                                      "n_flagged_lakes": len(hits), "flags": hits[:30],
                                      "buffer_flag_ha": round(sum(h["ha"] for h in hits), 2), "drain": drain_stats}
        r0, _ = roadness(x0)
        r1, o1 = roadness(x1)
        road_all = ndi.binary_dilation((r1 > thr["road_r"]) & (r0 < thr["road_r0"]), iterations=1)
        leads, lw_meta = lake_water_check(aoi, lakes, i0, i1, valid & okpx, thr, RAIN_NOTE, road_all)
        val["lake_water_check"] = {**lw_meta, "n_lakes_checked": len(leads), "n_lake_filling_leads": sum(r["lake_filling_lead"] for r in leads),
                                   "lead_ha": round(sum(r["lost_to_bare_ha"] + r["lost_to_built_ha"] for r in leads if r["lake_filling_lead"]), 2),
                                   "top": leads[:20]}
        sl, cats, ranked_all = site_ledger(aoi, thr, mask, cleared, built, road_all, o1, wr, props, wc, ring & mask, hits, dm & mask, drain_stats, leads)
        (paths.REPORTS / f"sites_{aoi}.json").write_text(json.dumps(sl, separators=(",", ":")), encoding="utf-8")
        asum = survey(aoi, thr, i0, i1, valid, okpx, mask, cleared, built, wr, props, cats)
        val["site_categories"] = {"counts": sl["category_counts"], "n_buffer_flagged_sites": sl["n_buffer_flagged_sites"],
                                  "n_near_drain_sites": sl["n_near_drain_sites"]}
        samp = audit_sample(ranked_all)
        for k, r in enumerate(samp):
            r["audit_id"] = f"{r['category'][:3]}{k:02d}"
        (paths.REPORTS / f"audit_{aoi}_sample.json").write_text(json.dumps(
            [{k: r.get(k) for k in ("audit_id", "category", "ha", "lat", "lon", "site", "osm_id", "lake")} for r in samp], indent=0),
            encoding="utf-8")
        audit_grids(aoi, samp, mask)
        val["anchor_sites"] = []
        val["anchor_note"] = "Boeing campus claim removed: coordinates unconfirmed and not located in the 10 m mosaics."
        val["growth_sanity"] = {k: asum[k] for k in ("built_pp_per_yr", "published", "growth_caveat")}
        crop_amb = sum(r["ha_cleared"] for r in recs if r["valid"] and r["cropland"] >= 0.5 and r["ha_built"] < 0.1)
        val["crop_ambiguity"] = {"cleared_only_ha_in_cropland_chips": round(crop_amb, 1),
                                 "note": "cleared-only tiles in WorldCover-cropland-dominant chips (>=50%) may be harvested/fallow fields"}
    ranked = sorted((r for r in recs if r["valid"]), key=lambda r: -r["ha"])
    thr_ha = 1.0
    summary = {"kind": kind, "thresholds": thr, "total_changed_ha": round(float(ha.sum()), 2),
               "n_tiles_changed": int(((ha > 0) & ok).sum()), "n_tiles_over_1ha": int((ha >= thr_ha).sum()),
               "n_invalid_tiles": int((~ok).sum()), "top20": ranked[:20]}
    # captures: each capture vs t0, same frozen rules + validity gate (compact records for the sim)
    slim = lambda i, kk, sv, v, vfr: {"i": i, "kind": kind, "sev": round(float(sv), 5), "ha": round(float(sv) * paths.CHIP_HA, 3),
                                      "valid": bool(v), "valid_frac": round(float(vfr), 3)}
    captures = {"t1": [{k: r[k] for k in ("i", "kind", "sev", "ha", "valid", "valid_frac")} for r in recs]}
    for dname in ("c1", "c2"):
        if not (paths.CHIPS / f"{aoi}_{dname}.npy").exists():
            continue
        xd, sd = load_aoi(aoi, dname)
        vd = valid_mask(s0, sd)
        md = detect(kind, x0, xd, vd, thr, ctx)[0]
        sv, vfr, okd, _ = chip_stats(md, vd, {})
        captures[dname] = [slim(i, None, sv[i], okd[i], vfr[i]) for i in range(N)]
        del xd, sd, vd, md
    captures = {k: captures[k] for k in ("c1", "t1", "c2") if k in captures}
    out = {"aoi": aoi, "pair": ["t0", "t1"], "tiles": recs, "captures": captures,
           "captures_note": "each capture vs t0, same frozen rules and valid_frac>=0.85 gate; c1/c2 can differ in season from t0 "
                            "(c2 is a 2026 scene), so their sev includes seasonal change",
           "summary": summary, "validation": val}
    paths.ensure(paths.REPORTS)
    (paths.REPORTS / f"change_{aoi}.json").write_text(json.dumps(out), encoding="utf-8")
    lo, hi = write_images(aoi, ("t0", "t1", "c1", "c2"), mask & chip_to_px(ok))
    x0c = np.load(paths.CHIPS / f"{aoi}_t0.npy", mmap_mode="r")
    x1c = np.load(paths.CHIPS / f"{aoi}_t1.npy", mmap_mode="r")
    qa_grid(aoi, kind, recs, x0c, x1c, cmask, lo, hi)
    if kind == "construction":
        apply_audit(aoi)
    inj = val["injected"].get("recall_by_size")
    print(f"[{aoi}] {kind}: total {summary['total_changed_ha']} ha, {summary['n_tiles_over_1ha']} tiles >=1ha, "
          f"{summary['n_invalid_tiles']} invalid; injected recall {inj}")
    return out


def main(argv):
    ap = argparse.ArgumentParser(prog="herald change")
    ap.add_argument("cmd", nargs="?")
    ap.add_argument("--aoi")
    ap.add_argument("--retune", action="store_true")
    a = ap.parse_args(argv)
    cfg = json.loads(CFG_PATH.read_text(encoding="utf-8")) if CFG_PATH.exists() else json.loads(json.dumps(DEFAULTS))
    for k, v in DEFAULTS.items():
        cfg[k] = {**v, **cfg.get(k, {})}
    aois = json.loads((paths.CONFIG / "aois.json").read_text(encoding="utf-8"))["aois"]
    for ao in sorted(aois, key=lambda x: x["kind"] != "construction"):   # blr first: tunes thresholds
        if a.aoi and ao["id"] != a.aoi:
            continue
        need = [paths.CHIPS / f"{ao['id']}_{d}.npy" for d in ("t0", "t1")] + [paths.LABELS / f"{ao['id']}.npz"]
        if not all(p.exists() for p in need):
            print(f"[{ao['id']}] skipped: vault files missing")
            continue
        run_aoi(ao["id"], ao["kind"], cfg, a.retune)
    CFG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return 0
