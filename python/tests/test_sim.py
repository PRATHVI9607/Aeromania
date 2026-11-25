import json

from herald import sim


def test_sim_smoke_synthetic(tmp_path, monkeypatch):
    monkeypatch.setattr(sim, "WEB_DATA", tmp_path / "d")
    monkeypatch.setattr(sim, "REPORTS", tmp_path / "r")
    monkeypatch.setattr(sim, "real", lambda phases: None)
    assert sim.main(["sim", "--days", "5"]) == 0
    rep = json.loads((tmp_path / "r" / "sim.json").read_text())
    assert rep["synthetic"] and rep["checks"] and all(rep["checks"].values())
    for n in ("tiles", "results", "queries", "windows", "track"):
        d = json.loads((tmp_path / "d" / f"{n}.json").read_text())
        assert d["synthetic"] if n != "track" else d["lon"]
    t = json.loads((tmp_path / "d" / "tiles.json").read_text())
    assert t["fields"][0] == "id" and len(t["rows"][0]) == len(t["fields"])
    r = json.loads((tmp_path / "d" / "results.json").read_text())
    assert set(r["by_rho"]) == {"1", "2", "5", "10"} and set(r["by_rho"]["5"]) == {"B1", "B2", "B3", "H1", "H2"}


def test_change_for_prefers_captures():
    chg = {"tiles": [{"i": 0, "sev": 0.1}], "captures": {"c1": [{"i": 0, "sev": 0.5}]}}
    assert sim.change_for(chg, "c1") == ({0: {"i": 0, "sev": 0.5}}, "captures")
    assert sim.change_for(chg, "t1")[1] == "tiles(t1 only)"
    assert sim.change_for(chg, "c2") == ({}, "none")
    assert sim.change_for({"tiles": [], "captures": {"t1": []}}, "t1")[1] == "captures"
