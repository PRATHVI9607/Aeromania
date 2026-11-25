import numpy as np

from herald import change as ch


def _scene(h=64):
    x = np.zeros((5, h, h), np.float32)
    x[0], x[1], x[2], x[3], x[4] = 0.03, 0.06, 0.04, 0.40, 0.18   # vegetation
    return x


def test_indices_known_values():
    x = np.array([0.1, 0.2, 0.1, 0.5, 0.3], np.float32).reshape(5, 1, 1)
    i = ch.indices(x)
    assert np.isclose(i["ndvi"], 0.4 / 0.6) and np.isclose(i["ndbi"], -0.25)
    assert np.isclose(i["mndwi"], -0.2) and np.isclose(i["bsi"], (0.4 - 0.6) / 1.0)
    assert ch.indices(np.zeros((5, 2, 2), np.float32))["ndvi"].sum() == 0   # no div-by-zero


def test_rule_detects_painted_patch_and_sev_ha():
    x0 = _scene()
    x1 = x0.copy()
    x1[:, 10:30, 10:30] = np.array([0.15, 0.17, 0.20, 0.22, 0.30], np.float32).reshape(5, 1, 1)  # built-like, 400 px
    m = ch.detect("construction", x0, x1, np.ones((64, 64), bool), ch.DEFAULTS["construction"])[0]
    assert m.sum() == 400 and m[10:30, 10:30].all()
    sev = m.sum() / ch.CHIP_PX
    assert np.isclose(sev * 40.96, 4.0, atol=0.01)


def test_small_component_removed():
    m = np.zeros((20, 20), bool)
    m[1:3, 1:3] = True       # 4 px
    m[10:15, 10:15] = True   # 25 px
    k = ch.remove_small(m, 8)
    assert not k[1:3, 1:3].any() and k[10:15, 10:15].all()


def test_invalid_chip_not_scored():
    s = np.zeros((64, 64), np.uint8) + 4
    s[:, :20] = 9   # cloud on ~31% + dilation
    v = ch.valid_mask(s, np.full_like(s, 4))
    assert v.mean() < ch.VALID_FRAC
    x0 = _scene()
    x1 = x0.copy()
    x1[:, 40:60, 40:60] = 0.2
    m = ch.detect("construction", x0, x1, v, ch.DEFAULTS["construction"])[0]
    full = np.tile(m, (ch.G, ch.G)) if False else None  # chip-level gating is in chip_stats
    big = np.zeros((ch.M, ch.M), bool)
    vb = np.zeros((ch.M, ch.M), bool)
    big[:64, :64], vb[:64, :64] = m, v
    sev, vf, ok, _ = ch.chip_stats(big, vb, {})
    assert not ok[0] and sev[0] == 0


def test_roadness_thin_line_vs_blob():
    x = np.full((5, 40, 40), 0.2, np.float32)
    x[:3, 20, 5:35] = 0.35        # thin 1 px bright line
    x[:3, 5:12, 5:12] = 0.35      # 7x7 blob (survives a 3x3 opening)
    r, _ = ch.roadness(x)
    assert r[20, 10:30].min() > 0.1 and r[8, 8] < 1e-6
