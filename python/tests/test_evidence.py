import copy

from herald import evidence as ev

REQ = {"card_id", "aoi", "kind", "lat", "lon", "bbox", "ha", "n_pits", "dates", "cloud_pct", "indices", "s1", "model",
       "confidence", "images", "caveat", "prev_hash", "hash"}


def _doc(tmp_path):
    cards = []
    for k in range(3):
        f = tmp_path / f"ev_c{k}_t0.jpg"
        f.write_bytes(bytes([k]) * 50)
        cards.append({"card_id": f"c{k}", "aoi": "sone", "kind": "sand_pits", "lat": 1.0, "lon": 2.0, "bbox": [0, 0, 1, 1], "ha": 1.0,
                      "n_pits": 1, "dates": {}, "cloud_pct": {}, "indices": {}, "s1": {}, "model": {}, "confidence": 0.5,
                      "images": {"t0": {"path": f"data/img/{f.name}", "sha256": ev.sha_file(f)}}, "caveat": ev.CAVEAT})
    ev.chain(cards)
    return {"cards": cards, "chain_head": cards[-1]["hash"]}


def test_schema_and_verify_ok(tmp_path):
    d = _doc(tmp_path)
    assert REQ <= set(d["cards"][0]) and ev.verify(d, tmp_path) == []
    assert d["cards"][0]["prev_hash"] == ev.GEN and d["cards"][1]["prev_hash"] == d["cards"][0]["hash"]


def test_tamper_detected(tmp_path):
    d = _doc(tmp_path)
    t = copy.deepcopy(d)
    t["cards"][1]["ha"] = 99.0
    assert any("hash mismatch" in b for b in ev.verify(t, tmp_path))
    t = copy.deepcopy(d)
    del t["cards"][1]
    assert any("prev_hash" in b for b in ev.verify(t, tmp_path))
    (tmp_path / "ev_c0_t0.jpg").write_bytes(b"x")
    assert any("image" in b for b in ev.verify(d, tmp_path))
