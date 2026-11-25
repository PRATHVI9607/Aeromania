"""Track C evidence cards: hash-chained leads (land-cover change only, aggregate per tile, never people/vehicles).

Usage: python -m herald evidence [build|audit|verify]
  audit   render top-15 leads per AOI as t0|t1|t1+mask crops to reports/qa/audit_trackc_{aoi}.png (for the reviewer)
  build   cards from reports/change_{aoi}.json + reports/audit_trackc.json labels -> reports/evidence.json (+ web copy, jpgs)
  verify  recompute every card hash, the prev_hash chain and the image sha256
"""
import hashlib
import json
import sys

import numpy as np

from . import paths

AOIS = ("sone", "hasdeo")
CAVEAT = "Evidence lead for authorized departments; requires ground verification; land-cover change only; not legal proof"
IMG = paths.WEB_DATA / "img"
GEN = "0" * 64


# ---------------------------------------------------------------- hash chain
def card_hash(card):
    body = {k: v for k, v in card.items() if k != "hash"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def chain(cards):
    prev = GEN
    for c in cards:
        c["prev_hash"] = prev
        c["hash"] = prev = card_hash(c)
    return cards


def sha_file(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def verify(doc, imgdir=None):
    """-> list of problems (empty = chain and images intact)."""
    imgdir, bad, prev = imgdir or IMG, [], GEN
    for k, c in enumerate(doc["cards"]):
        if c.get("prev_hash") != prev:
            bad.append(f"{c.get('card_id')}: prev_hash broken at position {k}")
        if card_hash(c) != c.get("hash"):
            bad.append(f"{c.get('card_id')}: hash mismatch (card edited)")
        for d, im in c["images"].items():
            f = imgdir / im["path"].rsplit("/", 1)[-1]
            if not f.exists() or sha_file(f) != im["sha256"]:
                bad.append(f"{c.get('card_id')}: image {d} missing or changed")
        prev = c.get("hash")
    if doc["cards"] and doc.get("chain_head") != prev:
        bad.append("chain_head does not match last card")
    return bad


# ---------------------------------------------------------------- leads
def leads(aoi, recs):
    """Deterministic ranked leads (tile level, aggregate). sone: pit tiles by pit ha, then disturbance tiles; hasdeo: by ha."""
    t = [r for r in recs if r["valid"]]
    if aoi == "sone":
        p = sorted((r for r in t if r["n_pits"]), key=lambda r: -r["pit_ha"])
        d = sorted((r for r in t if not r["n_pits"] and r["dist_ha"] >= 0.5), key=lambda r: -r["dist_ha"])
        return [dict(r, kind="sand_pits", lead_ha=r["pit_ha"]) for r in p] + [dict(r, kind="sand_disturbance", lead_ha=r["dist_ha"]) for r in d]
    c = sorted((r for r in t if r["ha"] >= 0.5), key=lambda r: -r["ha"])
    return [dict(r, kind="mine_expansion" if r["ha_mine_expansion"] > r["ha_forest_clearing"] else "forest_clearing", lead_ha=r["ha"]) for r in c]


def stretch(aoi):
    """Per-AOI per-band stretch (0.5-99.8%: 2-98% saturates the sand bars to white) shared by t0 and t1 (sampled chips)."""
    s = np.concatenate([np.load(paths.CHIPS / f"{aoi}_{d}.npy", mmap_mode="r")[::6][:, [2, 1, 0]].astype(np.float32).transpose(1, 0, 2, 3).reshape(3, -1)
                        for d in ("t0", "t1")], axis=1) / 1e4
    s = s[:, s.max(0) > 0]
    return np.percentile(s, 0.5, axis=1), np.percentile(s, 99.8, axis=1)


def rgb(chip, lo, hi):
    a = (chip[[2, 1, 0]].astype(np.float32) / 1e4 - lo[:, None, None]) / (hi - lo)[:, None, None]
    return (np.clip(a, 0, 1) ** (1 / 1.4) * 255).astype(np.uint8).transpose(1, 2, 0)


def _load(aoi):
    d = json.loads((paths.REPORTS / f"change_{aoi}.json").read_text(encoding="utf-8"))
    return d, leads(aoi, d["tiles"])


def audit(argv=()):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    for aoi in AOIS:
        d, ld = _load(aoi)
        ld = ld[:15]
        lo, hi = stretch(aoi)
        x0, x1 = (np.load(paths.CHIPS / f"{aoi}_{k}.npy", mmap_mode="r") for k in ("t0", "t1"))
        lm = np.load(paths.LABELS / f"leadmask_{aoi}.npz")
        fig, axs = plt.subplots(5, 9, figsize=(18, 10.4), squeeze=False)
        for ax in axs.ravel():
            ax.axis("off")
        for k, r in enumerate(ld):
            i, row, c0 = r["i"], k // 3, (k % 3) * 3
            m = lm["a"][i] | lm["b"][i]
            im1 = rgb(x1[i], lo, hi)
            ov = im1.copy()
            edge = m & ~__import__("scipy.ndimage", fromlist=["x"]).binary_erosion(m)
            ov[edge] = (255, 0, 0)
            for j, img in enumerate((rgb(x0[i], lo, hi), im1, ov)):
                axs[row, c0 + j].imshow(np.kron(img, np.ones((2, 2, 1), np.uint8)), interpolation="nearest")
            axs[row, c0].set_title(f"#{k} tile {i} {r['kind']} {r['lead_ha']:.2f} ha", fontsize=8, loc="left")
        fig.suptitle(f"{aoi}: top {len(ld)} leads, t0 | t1 | t1 + mask (2x, per-AOI 2-98% stretch)", fontsize=10)
        fig.tight_layout()
        paths.ensure(paths.REPORTS / "qa")
        fig.savefig(paths.REPORTS / "qa" / f"audit_trackc_{aoi}.png", dpi=80)
        plt.close(fig)
        print(aoi, [(k, r["i"]) for k, r in enumerate(ld)])
    return 0


# ---------------------------------------------------------------- cards
def build(argv=()):
    from PIL import Image
    paths.ensure(IMG)
    labels = json.loads((paths.REPORTS / "audit_trackc.json").read_text(encoding="utf-8"))
    cfg = json.loads((paths.CONFIG / "change_thresholds.json").read_text(encoding="utf-8"))
    model = json.loads((paths.REPORTS / "model.json").read_text(encoding="utf-8"))
    scenes = json.loads((paths.VAULT / "scenes.json").read_text(encoding="utf-8"))
    cards, rank = [], {"real": 0, "unsure": 1}
    for aoi in AOIS:
        d, ld = _load(aoi)
        meta = {t["i"]: t for t in json.loads((paths.VAULT / "meta" / f"{aoi}.json").read_text(encoding="utf-8"))["tiles"]}
        lab = np.load(paths.LABELS / f"{aoi}.npz")
        lo, hi = stretch(aoi)
        x = {k: np.load(paths.CHIPS / f"{aoi}_{k}.npy", mmap_mode="r") for k in ("t0", "t1")}
        lbl = {int(k): v for k, v in labels["leads"][aoi].items()}   # tile -> real|unsure|wrong
        prec = labels["precision"][aoi]
        sel = sorted((r for r in ld if lbl.get(r["i"], "unsure") in rank), key=lambda r: (rank[lbl.get(r["i"], "unsure")], -r["lead_ha"]))[:10]
        sc = scenes[aoi]
        for r in sel:
            i, t = r["i"], meta[r["i"]]
            ims = {}
            for k in ("t0", "t1"):
                f = IMG / f"ev_{aoi}{i:04d}_{k}.jpg"
                Image.fromarray(rgb(x[k][i], lo, hi)).resize((256, 256), Image.NEAREST).save(f, quality=88)
                ims[k] = {"path": f"data/img/{f.name}", "sha256": sha_file(f)}
            s1 = {"dvv": r.get("s1_dvv"), "dvh": r.get("s1_dvh"), "monsoon_activity": r.get("monsoon_activity")}
            cards.append({
                "card_id": f"{aoi}{i:04d}", "aoi": aoi, "kind": r["kind"], "audit_label": lbl.get(i, "unsure"),
                "lat": t["lat"], "lon": t["lon"], "bbox": t["bbox"], "ha": round(r["lead_ha"], 2), "n_pits": r.get("n_pits"),
                "dates": {"t0": sc["dates"]["t0"]["datetime"][:10], "t1": sc["dates"]["t1"]["datetime"][:10],
                          "monsoon_s1": sc["s1"]["monsoon"]["datetime"][:10]},
                "cloud_pct": {k: round(float(lab[f"cloud_{k}"][i]) * 100, 1) for k in ("t0", "t1")},
                "indices": {k: r.get(k) for k in ("dndvi", "dndbi", "dmndwi", "dbsi")},
                "s1": s1,
                "model": {"version": model["backbone"] + "; change engine: indices-and-rules v2",
                          "thresholds": cfg[d["summary"]["kind"]]},
                "confidence": prec.get(r["kind"]), "confidence_basis": "reviewer visual audit precision for this kind (strict: unsure counted as not real); not field-verified",
                "images": ims, "caveat": CAVEAT})
    chain(cards)
    doc = {"chain_head": cards[-1]["hash"] if cards else GEN, "n_cards": len(cards), "genesis": GEN, "audit": "reports/audit_trackc.json", "cards": cards}
    txt = json.dumps(doc, indent=1)
    (paths.REPORTS / "evidence.json").write_text(txt, encoding="utf-8")
    (paths.WEB_DATA / "evidence.json").write_text(txt, encoding="utf-8")
    print(f"{len(cards)} cards; verify:", verify(doc) or "OK")
    return 0


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "build"
    if cmd == "verify":
        bad = verify(json.loads((paths.REPORTS / "evidence.json").read_text(encoding="utf-8")))
        print("\n".join(bad) if bad else "evidence chain OK")
        return 1 if bad else 0
    return {"build": build, "audit": audit}[cmd](argv[2:])


if __name__ == "__main__":
    sys.exit(main(["evidence"] + sys.argv[1:]))
