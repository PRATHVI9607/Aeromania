import json

import numpy as np
import pytest

from herald import labels
from herald.paths import CHIPS, LABELS, VAULT


def test_wc_tile_names():
    assert labels.wc_tile_names(77.5, 13.0, 77.8, 13.3) == ["N12E075"]
    assert labels.wc_tile_names(83.9, 25.0, 84.1, 25.1) == ["N24E081", "N24E084"]


def test_chip_fractions():
    m = np.zeros((3000, 3000), bool)
    m[:64, :32] = True  # half of chip 0
    f = labels.chip_fractions(m)
    assert f.shape == (2116,) and f[0] == 0.5 and f[1:].sum() == 0


@pytest.mark.skipif(not (VAULT / "meta" / "blr.json").exists() or not (LABELS / "blr.npz").exists(),
                    reason="vault/labels not built")
@pytest.mark.parametrize("aoi", ["blr", "sone", "hasdeo"])
def test_label_shapes(aoi):
    p = LABELS / f"{aoi}.npz"
    if not p.exists():
        pytest.skip("aoi not built")
    z = np.load(p)
    assert z["wc"].shape == (2116, 11) and z["osm_constr"].shape == (2116,)
    for d in ("t0", "t1", "c1", "c2"):
        assert z[f"cloud_{d}"].shape == (2116,) and (z[f"cloud_{d}"] <= 1).all()
        assert np.load(CHIPS / f"{aoi}_{d}_scl.npy", mmap_mode="r").shape == (2116, 64, 64)
