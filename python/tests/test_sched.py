"""Scheduler invariants + Python<->TS parity fixture (python -m tests.test_sched regenerates it)."""
import json
import random
import time

from herald import sched, value
from herald.paths import ROOT

FX = ROOT / "python" / "tests" / "fixtures" / "sched_parity.json"
RHOS = [1, 2, 5, 10]
FIELDS = ["id", "aoi", "date", "t_cap_min", "cloud", "sev", "ha", "pA", "pC", "full_bytes"]


def run_all(fx):
    runs = {}
    for rho in RHOS:
        prep = sched.prepare(fx["tiles"], fx["queries"], fx["params"])
        for p in sched.POLICIES:
            o = sched.run(p, fx["tiles"], fx["windows"], fx["params"], fx["queries"], rho, prep)
            runs[f"{rho}/{p}"] = {"sel": [list(s) for s in o["sel"]], "metrics": o["metrics"]}
    return runs


def make_fixture():
    from herald import orbit, sim
    params, queries = value.load()
    tiles = sim.synthetic({"blr": 330.0, "sone": 320.0, "hasdeo": 320.0})
    tiles = random.Random(3).sample(tiles, 300)
    tiles.sort(key=lambda t: (t["t_cap_min"], t["aoi"], t["i"]))
    tiles = [{**{k: t[k] for k in FIELDS if k != "id"}, "id": n} for n, t in enumerate(tiles)]
    wins = [w for w in orbit.windows(5) if w["start_min"] >= 330][:80]
    wins = [{"id": n, "start_min": w["start_min"], "end_min": w["end_min"]} for n, w in enumerate(wins)]
    fx = {"params": params, "queries": queries, "tiles": tiles, "windows": wins}
    fx["runs"] = run_all(fx)
    FX.parent.mkdir(parents=True, exist_ok=True)
    FX.write_text(json.dumps(fx), encoding="utf-8")


def fx():
    return json.loads(FX.read_text(encoding="utf-8"))


def test_parity_fixture_regenerates():
    f = fx()
    assert json.loads(json.dumps(run_all(f))) == f["runs"]


def test_invariants():
    f = fx()
    for rho in RHOS:
        res = {p: sched.run(p, f["tiles"], f["windows"], f["params"], f["queries"], rho) for p in sched.POLICIES}
        for o in res.values():
            tl = o["timeline"]
            assert all(b <= c + 1e-6 for b, c in zip(tl["bytes"], tl["cap"], strict=True))              # capacity respected
            assert all(f["tiles"][i]["t_cap_min"] <= f["windows"][w]["start_min"] for i, _, w in o["sel"])  # eligibility
            assert o["metrics"]["value"] <= o["metrics"]["ub"] + 1e-6                        # UB
            assert len({(i, L) for i, L, _ in o["sel"]}) == len(o["sel"])                    # nothing sent twice
            assert o["metrics"]["bytes_sent"] <= o["metrics"]["capacity_bytes"] + 1e-6
        assert res["H2"]["metrics"]["value"] >= res["B1"]["metrics"]["value"]
        assert res["H1"]["metrics"]["value"] >= res["B1"]["metrics"]["value"]


def test_deterministic():
    f = fx()
    a = sched.run("H2", f["tiles"], f["windows"], f["params"], f["queries"], 5)
    assert a["sel"] == sched.run("H2", f["tiles"], f["windows"], f["params"], f["queries"], 5)["sel"]


def test_g5_timing_1000_tiles():
    f = fx()
    rng = random.Random(1)
    tiles = [{**rng.choice(f["tiles"]), "t_cap_min": rng.uniform(300, 3000)} for _ in range(1000)]
    tiles.sort(key=lambda t: t["t_cap_min"])
    best = 1e9
    for _ in range(5):
        s = time.perf_counter()
        sched.run("H2", tiles, f["windows"], f["params"], f["queries"], 5)
        best = min(best, time.perf_counter() - s)
    assert best < 0.010, best


if __name__ == "__main__":
    make_fixture()
