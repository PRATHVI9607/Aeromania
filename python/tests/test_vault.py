import json

import numpy as np

from herald import vault


def test_manifest_roundtrip(tmp_path):
    (tmp_path / "chips").mkdir()
    (tmp_path / "raw").mkdir()
    (tmp_path / "chips" / "a.npy").write_bytes(b"abc")
    (tmp_path / "raw" / "skip.bin").write_bytes(b"zzz")
    m = vault.write_manifest(tmp_path)
    assert set(m) == {"chips/a.npy"}
    assert vault.verify_manifest(tmp_path) == []
    (tmp_path / "chips" / "a.npy").write_bytes(b"abd")
    assert vault.verify_manifest(tmp_path) == ["chips/a.npy"]
    (tmp_path / "chips" / "a.npy").unlink()
    assert vault.verify_manifest(tmp_path) == ["chips/a.npy"]


def test_tiling_indices_and_shape():
    a = np.arange(2 * 3000 * 3000, dtype=np.uint32).reshape(2, 3000, 3000)
    c = vault.tile_chips(a)
    assert c.shape == (2116, 2, 64, 64)
    i = 3 * 46 + 5  # row 3, col 5
    assert np.array_equal(c[i], a[:, 3 * 64:4 * 64, 5 * 64:6 * 64])
    assert np.array_equal(c[-1, 1], a[1, 45 * 64:46 * 64, 45 * 64:46 * 64])


def test_harmonize_boa_offset():
    dn = np.array([0, 500, 1000, 1500, 11000], np.uint16)
    assert vault.harmonize(dn, True).tolist() == [0, 0, 0, 500, 10000]
    assert vault.harmonize(dn, False).tolist() == dn.tolist()
    assert vault.harmonize(dn, True).dtype == np.uint16


def test_needs_boa_offset():
    nir_off = np.full(100, 1200, np.uint16)
    nir_ok = np.full(100, 300, np.uint16)
    old = {"s2:processing_baseline": "03.01"}
    new = {"s2:processing_baseline": "04.00", "earthsearch:boa_offset_applied": False}
    flagged = {"s2:processing_baseline": "05.10", "earthsearch:boa_offset_applied": True}
    assert not vault.needs_boa_offset(old, nir_off)
    assert vault.needs_boa_offset(new, nir_off) and vault.needs_boa_offset(new)
    assert not vault.needs_boa_offset(new, nir_ok)  # data already offset-free
    assert not vault.needs_boa_offset(flagged, nir_off)


def test_scl_cloud_fraction():
    scl = np.full((2, 4, 4), 4, np.uint8)
    scl[0, :2] = 9   # 50% cloud
    scl[1, 0, :] = 3  # shadow counts
    scl[1, 1, :2] = 0
    scl[0, 2] = 0
    cloud, nodata = vault.scl_fractions(scl)
    assert cloud.tolist() == [0.5, 0.25]
    assert nodata.tolist() == [0.25, 0.125]


def test_meta_grid_and_db():
    m = vault.tiles_meta("x", 32643, (700000.0, 1500000.0))
    assert len(m["tiles"]) == 2116 and m["tiles"][47]["row"] == 1 and m["tiles"][47]["col"] == 1
    db = vault.to_db(np.array([0.0, 1.0, 0.1], np.float32))
    assert db.dtype == np.float16 and db.tolist() == [-40.0, 0.0, -10.0]
