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
                     "osm_frac": 0.02, "tuned": False},
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
             & (i1["mndwi"] < 0) & (i0["mndwi"] < 0))
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
    m = remove_small(m & valid, thr["min_px"])
    return m, i0, i1, buf, d


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
            "tp": tp, "fp": fp, "fn": fn, "n": int(len(pred)), "n_pos": int(lab.sum())}


def tune_construction(x0, x1, valid, osm, ok_chip, thr):
    """Grid search on west half of chip columns (col < 23); returns best thr + west/east P/R at the frozen choice."""
    col = np.tile(np.arange(G), G)
    west, east = col < G // 2, col >= G // 2
    lab = osm >= thr["osm_frac"]
    best = None
    for a, b, mn in itertools.product((0.10, 0.15, 0.20, 0.25, 0.30), (0.0, 0.03, 0.06, 0.10), (4, 8, 12)):
        t = dict(thr, a_dndvi=a, b_dndbi=b, min_px=mn)
        m = detect("construction", x0, x1, valid, t)[0]
        sev = chipify(m).reshape(N, -1).sum(1) / CHIP_PX
        pred = (sev * paths.CHIP_HA >= t["chip_ha"]) & ok_chip
        s = prf(pred[west & ok_chip], lab[west & ok_chip])
        if best is None or s["f1"] > best[0]:
            best = (s["f1"], t, pred)
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
        veg = i0["ndvi"] > 0.3
    else:
        pool_m = valid & (i1["ndvi"] < 0.2) & (i1["bsi"] > 0) & (i1["mndwi"] < 0)
        veg = i0["ndvi"] > thr["forest_ndvi"]
    pool = x1[:, pool_m]
    if pool.shape[1] < 500:
        return {"error": "too few source pixels", "pool_px": int(pool.shape[1])}
    pool = pool[:, rng.choice(pool.shape[1], min(pool.shape[1], 200000), replace=False)]
    cv = chipify(valid).reshape(N, -1).mean(1)
    cveg = chipify(veg & valid).reshape(N, -1).mean(1)
    cand = np.flatnonzero((cv >= 0.99) & (cveg >= 0.9) & (base_sev == 0))
    res = {"n_candidate_chips": int(len(cand)), "pool_px": int(pool.shape[1]), "recall_by_size": {},
           "chip_detect_by_size": {}, "seed": 11}
    if len(cand) < per_size:
        res["error"] = "not enough fully-vegetated clean chips"
        return res
    chips_x0, chips_x1 = x0.reshape(5, G, C, G, C), x1.reshape(5, G, C, G, C)
    for ha in SIZES_HA:
        pick = rng.choice(cand, per_size, replace=False)
        hit = chip_hit = 0
        for i in pick:
            r, c = divmod(int(i), G)
            a0, a1 = chips_x0[:, r, :, c, :].copy(), chips_x1[:, r, :, c, :].copy()
            side = max(2, int(round(np.sqrt(ha * 100))))
            y, x = (int(v) for v in rng.integers(2, C - side - 1, 2))
            _paint(a1, rng, pool, y, x, ha)
            v = np.ones((C, C), bool)
            ctx = ctx_fn(int(i)) if ctx_fn else None
            m = detect(kind, a0, a1, v, thr, ctx)[0]
            frac = m[y:y + side, x:x + side].mean()
            hit += frac >= 0.5
            chip_hit += bool(m.any())
        res["recall_by_size"][str(ha)] = round(hit / per_size, 3)
        res["chip_detect_by_size"][str(ha)] = round(chip_hit / per_size, 3)
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
        vf = chipify(valid).reshape(N, -1).mean(1)
        osm = lab["osm_constr"]
        if retune or not thr.get("tuned"):
            thr, pr = tune_construction(x0, x1, valid, osm, vf >= VALID_FRAC, thr)
            cfg[kind] = thr
            CFG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
            val["tuning"] = "grid on west half (cols<23), chip F1 vs OSM, frozen"
        else:
            pr = None
    mask, i0, i1, buf, d = detect(kind, x0, x1, valid, thr, ctx)
    deltas = {"dndvi": d["ndvi"], "dndbi": d["ndbi"], "dmndwi": d["mndwi"], "dbsi": d["bsi"]}
    sev, vf, ok, means = chip_stats(mask, valid, deltas)
    ha = sev * paths.CHIP_HA
    cmask = chipify(mask & chip_to_px(ok))
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
    ranked = sorted((r for r in recs if r["valid"]), key=lambda r: -r["ha"])
    thr_ha = 1.0
    summary = {"kind": kind, "thresholds": thr, "total_changed_ha": round(float(ha.sum()), 2),
               "n_tiles_changed": int(((ha > 0) & ok).sum()), "n_tiles_over_1ha": int((ha >= thr_ha).sum()),
               "n_invalid_tiles": int((~ok).sum()), "top20": ranked[:20]}
    out = {"aoi": aoi, "pair": ["t0", "t1"], "tiles": recs, "summary": summary, "validation": val}
    paths.ensure(paths.REPORTS)
    (paths.REPORTS / f"change_{aoi}.json").write_text(json.dumps(out), encoding="utf-8")
    lo, hi = write_images(aoi, ("t0", "t1", "c1", "c2"), mask & chip_to_px(ok))
    x0c = np.load(paths.CHIPS / f"{aoi}_t0.npy", mmap_mode="r")
    x1c = np.load(paths.CHIPS / f"{aoi}_t1.npy", mmap_mode="r")
    qa_grid(aoi, kind, recs, x0c, x1c, cmask, lo, hi)
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
        cfg.setdefault(k, v)
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
