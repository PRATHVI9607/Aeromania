"""Capture timeline -> scheduler -> results.json (PRD s9/s10). `python -m herald sim [--days N]`.

Tile construction (real mode, needs vault/meta, vault/scores, reports/change_*.json, vault/chips for all AOIs):
- Each AOI date in {c1, c2, t1} is one capture event (t0 = onboard reference baseline, never downlinked), ordered by real date.
- Timing is a COMPRESSED REPLAY: capture j (0,1,2) of an AOI happens on sim day j at the AOI's real daytime-overpass
  time-of-day (from the Skyfield swath crossing). The day index is synthetic, the time of day is orbital geometry.
- sev/ha/kind come from the t0->t1 change report and are applied to all three captures; cloud is per capture, so
  cloudy captures are worth less via (1-cloud).
- p_rel (calibrated class probs P at the capture), gated by sev>0:
    pack A (blr, construction): P(Industrial)+P(Residential)+P(Highway)
    pack C sand (sone):         P(River)+P(SeaLake)      (bar/channel looks like water at 10 m; modeled mapping)
    pack C clearing (hasdeo):   P(Forest) at t0 (what was there before the change)
- full_bytes = len(zlib.compress(chip.tobytes(), 6)) per chip.
Otherwise a seeded synthetic generator is used and every output carries "synthetic": true.
Windows: all contact windows from the first capture onward; capacity is split by duration. Overlapping windows of
different stations are treated as independent (limitation). Unused capacity in a window is not carried over.
"""
import argparse
import json
import os
import time
import zlib

import numpy as np

from herald import orbit, sched, value
from herald.paths import CHIP_HA, CONFIG, REPORTS, SCORES, VAULT, WEB_DATA, ensure

RHOS = [1, 2, 5, 10]
CLASSES = ["AnnualCrop", "Forest", "HerbaceousVegetation", "Highway", "Industrial", "Pasture", "PermanentCrop",
           "Residential", "River", "SeaLake"]
FIELDS = ["id", "aoi", "date", "t_cap_min", "lat", "lon", "cls", "conf", "cloud", "kind", "sev", "ha", "pA", "pC", "full_bytes"]
KIND = {"blr": "construction", "sone": "sand", "hasdeo": "clearing"}
G = 46


def aois():
    return json.loads((CONFIG / "aois.json").read_text(encoding="utf-8"))["aois"]


def _tile(aoi, date, t, i, lat, lon, probs, cloud, kind, sev, ha, pA, pC, fb):
    return {"aoi": aoi, "date": date, "t_cap_min": round(t, 2), "i": i, "lat": round(lat, 4), "lon": round(lon, 4),
            "cls": int(np.argmax(probs)), "conf": round(float(np.max(probs)), 3), "cloud": round(float(cloud), 3),
            "kind": kind, "sev": round(float(sev), 3), "ha": round(float(ha), 2),
            "pA": round(float(pA), 3), "pC": round(float(pC), 3), "full_bytes": int(fb)}


def synthetic(phases, seed=7):
    rng = np.random.default_rng(seed)
    out = []
    for a in aois():
        la, lo = a["center"]
        sev = np.zeros(G * G)
        for _ in range(6):                                   # a few change blobs
            r, c = rng.integers(3, G - 3, 2)
            rr, cc = np.divmod(np.arange(G * G), G)
            sev += rng.uniform(0.2, 0.7) * np.exp(-((rr - r) ** 2 + (cc - c) ** 2) / (2 * rng.uniform(1, 4) ** 2))
        sev = np.where(sev > 0.04, np.clip(sev, 0, 1), 0)
        for j, (date, mcl) in enumerate([("c1", 0.45), ("c2", 0.2), ("t1", 0.05)]):
            cloud = rng.beta(0.5, 0.5 * (1 / mcl - 1), G * G)
            for i in range(G * G):
                r, c = divmod(i, G)
                probs = rng.dirichlet(np.ones(10) * 0.3)
                hit = sev[i] > 0
                pk = min(1.0, 0.55 + 0.4 * rng.random()) if hit else 0.25 * rng.random()
                pA = pk if a["pack"] == "A" and hit else 0.0
                pC = pk if a["pack"] == "C" and hit else 0.0
                fb = max(3000, rng.normal(22000, 3500) - 9000 * cloud[i])
                out.append(_tile(a["id"], date, j * 1440 + phases[a["id"]], i, la + (23 - r) * 0.0027, lo + (c - 23) * 0.0028,
                                 probs, cloud[i], KIND[a["id"]] if hit else "none", sev[i], sev[i] * CHIP_HA * 0.8, pA, pC, fb))
    return out


SOURCE = {}   # "aoi/date" -> "captures" | "tiles(t1 only)" | "none"


def change_for(chg, d):
    """Per-tile change records {i: rec} for capture d (each vs t0). Prefer chg["captures"][d]; else chg["tiles"] for t1 only
    (other dates get no change, i.e. zero value)."""
    if d in chg.get("captures", {}):
        return {t["i"]: t for t in chg["captures"][d]}, "captures"
    if d == "t1":
        return {t["i"]: t for t in chg["tiles"]}, "tiles(t1 only)"
    return {}, "none"


def real(phases):
    """Tiles from vault outputs, or None if any input is missing."""
    try:
        scenes = json.loads((VAULT / "scenes.json").read_text(encoding="utf-8"))
        out = []
        for a in aois():
            k = a["id"]
            meta = json.loads((VAULT / "meta" / f"{k}.json").read_text(encoding="utf-8"))["tiles"]
            ch = json.loads((REPORTS / f"change_{k}.json").read_text(encoding="utf-8"))
            chg = ch
            dates = sorted(("c1", "c2", "t1"), key=lambda d: scenes[k]["dates"][d]["datetime"])
            t0 = np.load(SCORES / f"{k}_t0.npz")["probs"]
            for j, d in enumerate(dates):
                sc = np.load(SCORES / f"{k}_{d}.npz")
                chips = np.load(VAULT / "chips" / f"{k}_{d}.npy", mmap_mode="r")
                ch, used = change_for(chg, d)
                SOURCE[f"{k}/{d}"] = used
                for m in meta:
                    i, p = m["i"], sc["probs"][m["i"]]
                    c = ch.get(i, {"sev": 0, "ha": 0, "kind": "none"})
                    gate = c["sev"] > 0 and c.get("valid", True)
                    pA = (p[3] + p[4] + p[7]) * gate if a["pack"] == "A" else 0.0
                    pC = 0.0
                    if a["kind"] == "sand":
                        pC = (p[8] + p[9]) * gate
                    elif a["kind"] == "clearing":
                        pC = t0[i][1] * gate
                    out.append(_tile(k, d, j * 1440 + phases[k], i, m["lat"], m["lon"], p, sc["cloud"][i], c["kind"],
                                     c["sev"], c["ha"], pA, pC, len(zlib.compress(chips[i].tobytes(), 6))))
        return out
    except (FileNotFoundError, KeyError):
        return None


def build(phases):
    tiles, syn = real(phases), False
    if tiles is None:
        tiles, syn = synthetic(phases), True
    tiles.sort(key=lambda t: (t["t_cap_min"], t["aoi"], t["i"]))
    for n, t in enumerate(tiles):
        t["id"] = n
    return tiles, syn


PROC_LAT_MIN = 1.0   # assumption: onboard inference + packing latency between capture and first downlink byte


def split_windows(wins, t_caps):
    """Split each contact window at (capture time + PROC_LAT_MIN) so tiles captured mid-pass can downlink in the same pass
    (Sentinel-2 style real-time downlink). Scheduler stays unchanged: capacity is pro-rated by segment duration there."""
    cuts, out = sorted({t + PROC_LAT_MIN for t in t_caps}), []
    for w in wins:
        pts = [w["start_min"], *[c for c in cuts if w["start_min"] < c < w["end_min"]], w["end_min"]]
        for a, b in zip(pts, pts[1:], strict=False):
            out.append({**w, "parent": w["id"], "start_min": round(a, 3), "end_min": round(b, 3), "dur_min": round(b - a, 3)})
    for i, w in enumerate(out):
        w["id"] = i
    return out


def _r(x, k=2):
    return None if x is None else round(x, k)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="herald sim")
    ap.add_argument("cmd", nargs="?")
    ap.add_argument("--days", type=int, default=5)
    a = ap.parse_args(argv)
    ensure(WEB_DATA, REPORTS)
    params, queries = value.load()
    raw = json.loads((CONFIG / "value.json").read_text(encoding="utf-8"))
    wins = orbit.windows(a.days)
    caps, phases = {}, {}
    for x in aois():
        ov = orbit.overpasses(tuple(x["center"]))
        caps[x["id"]] = ov
        phases[x["id"]] = ov[0]["t_min"] % 1440 if ov else 330.0   # fallback 05:30 UTC
    tiles, syn = build(phases)
    t_first = min(t["t_cap_min"] for t in tiles)
    uw = split_windows([w for w in wins if w["end_min"] > t_first], sorted({t["t_cap_min"] for t in tiles}))
    prep = sched.prepare(tiles, queries, params)
    res = {}
    for rho in RHOS:
        r = {}
        for p in sched.POLICIES:
            o = sched.run(p, tiles, uw, params, queries, rho, prep)
            m = {k: _r(v, 4) for k, v in o["metrics"].items()}
            r[p] = {"metrics": m, "level": o["level"], "timeline": {k: [round(x, 2) for x in v] for k, v in o["timeline"].items()}}
        res[str(rho)] = r
    # G5 timing: H2 on 1000 tiles
    sub = tiles[:: max(1, len(tiles) // 1000)][:1000]
    t5 = []
    for _ in range(5):
        s = time.perf_counter()
        sched.run("H2", sub, uw, params, queries, 5)
        t5.append(time.perf_counter() - s)
    # headline. Minutes to reach a realized-value target, linear inside the window it is crossed.
    dur = [w["end_min"] - w["start_min"] for w in uw]

    def mins_to(tl, target):
        if target <= 0:
            return 0.0
        used, prev = 0.0, 0.0
        for d, c in zip(dur, tl["cum_value"], strict=True):
            if c >= target:
                return used + d * (target - prev) / (c - prev)
            used, prev = used + d, c
        return None

    h = {}
    for rho in RHOS:
        R = res[str(rho)]
        m = {p: R[p]["metrics"] for p in sched.POLICIES}
        fifo = m["B1"]["value"]
        tm = {p: _r(mins_to(R[p]["timeline"], fifo - 0.01)) for p in sched.POLICIES}   # to match FIFO's final value
        h[str(rho)] = {"ratio_vs_fifo": {p: _r(m[p]["value"] / fifo, 3) if fifo else None for p in ("H1", "H2")},
                       "ratio_vs_b2": {p: _r(m[p]["value"] / m["B2"]["value"], 3) if m["B2"]["value"] else None for p in ("H1", "H2")},
                       "minutes_to_90": {p: m[p]["minutes_to_90"] for p in sched.POLICIES},
                       "minutes_to_match_fifo": tm,
                       "fifo_minutes_used": tm["B1"],
                       "minutes_saved_vs_fifo": {p: _r(tm["B1"] - tm[p]) if tm["B1"] is not None and tm[p] is not None else None for p in ("H1", "H2")},
                       "ttfi_min": {p: m[p]["ttfi_min"] for p in sched.POLICIES},
                       "pct_ub": {p: m[p]["pct_ub"] for p in sched.POLICIES}}
    sens = {}
    for f in (0.3, 0.5, 0.7):
        pp = {**params, "level_fraction": [f, *params["level_fraction"][1:]]}
        o = sched.run("H2", tiles, uw, pp, queries, 5)["metrics"]
        sens[str(f)] = {"H2_value": _r(o["value"]), "H2_vs_B1": _r(o["value"] / res["5"]["B1"]["metrics"]["value"], 3) if res["5"]["B1"]["metrics"]["value"] else None,
                        "H2_vs_B2": _r(o["value"] / res["5"]["B2"]["metrics"]["value"], 3) if res["5"]["B2"]["metrics"]["value"] else None}
    robust = {"note": "H1 sends full chips only: no packet-fraction assumption involved.",
              "H1_vs_B1": h["5"]["ratio_vs_fifo"]["H1"], "H1_vs_B2": h["5"]["ratio_vs_b2"]["H1"],
              "H2_packet_fraction_sensitivity_rho5": sens}
    by = {d: [t for t in tiles if t["date"] == d] for d in ("c1", "c2", "t1")}
    frac = {d: _r(sum(1 for t in v if t["pA"] + t["pC"] > 0 and t["sev"] > 0) / max(1, len(v)), 3) for d, v in by.items()}
    cl = {d: _r(float(np.mean([t["cloud"] for t in v])) if v else 0, 3) for d, v in by.items()}
    note = (f"The ratio vs FIFO is driven by how much of the downlink FIFO spends on tiles worth nothing. Fraction of tiles with value>0 "
            f"per capture: {frac}; mean cloud per capture: {cl}. FIFO sends in capture order so it fills windows with zero-value and cloudy tiles; "
            f"value-aware policies send the valuable ones first. Change source per capture: {sorted(set(SOURCE.values()))}. "
            f"If c1/c2 carry no change records they count as zero value, which flatters the ratio; check change_source below.")
    phys = orbit.physics(wins)
    checks = {"period_ok": 100.4 <= phys["period_tle_min"] <= 100.8, "inclination_ok": abs(phys["inclination_deg"] - 98.62) < 0.01,
              "max_pass_ok": 9.5 <= phys["max_pass_min"] <= 11.5, "min_el_ok": all(w["max_el"] >= orbit.MIN_EL for w in wins),
              "windows_nonempty": len(wins) > 0}
    assert all(checks.values()), (checks, phys)
    rep = {"synthetic": syn, "physics": phys, "checks": checks, "headline_rho5": h["5"], "by_rho": h, "robustness": robust, "headline_note": note, "change_source": dict(SOURCE), "frac_tiles_with_value": frac, "mean_cloud": cl, "load_avg": os.getloadavg() if hasattr(os, "getloadavg") else None,
           "g5_ms_per_1000_tiles_H2": round(min(t5) * 1000, 2),
           "capture_overpasses_10d_cycle": caps, "capture_phase_min_utc": phases,
           "n_tiles": len(tiles), "n_windows": len(wins), "n_windows_used": len(uw),
           "mapping": "see herald/sim.py docstring: compressed replay (day index synthetic, time-of-day from real overpass); "
                      "pA=P(Ind+Res+Hwy)xgate; pC sand=P(River+SeaLake)xgate, clearing=P(Forest@t0)xgate"}
    (REPORTS / "sim.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    def w(n, d):
        (WEB_DATA / n).write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
    w("tiles.json", {"synthetic": syn, "classes": CLASSES, "fields": FIELDS, "rows": [[t[f] for f in FIELDS] for t in tiles]})
    w("results.json", {"synthetic": syn, "rhos": RHOS, "policies": sched.POLICIES, "n_tiles": len(tiles),
                       "window_ids": [x["id"] for x in uw], "by_rho": res})
    w("queries.json", {"synthetic": syn, "params": raw["params"], "queries": raw["queries"]})
    w("sched_windows.json", {"synthetic": syn, "proc_latency_min": PROC_LAT_MIN, "windows": uw})
    w("windows.json", {"synthetic": syn, "epoch_utc": "2025-01-15T00:00:00Z", "min_el": orbit.MIN_EL,
                       "first_capture_min": t_first, "windows": wins})
    tr = orbit.track(a.days)
    w("track.json", tr)
    print(json.dumps({"synthetic": syn, "headline_rho5": h["5"], "g5_ms": rep["g5_ms_per_1000_tiles_H2"]}, indent=1))
    return 0
