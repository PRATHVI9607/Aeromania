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


def test_growth_per_road_km_synthetic_wards():
    from shapely.geometry import LineString, box
    a, b = box(0, 0, 2000, 2000), box(2000, 0, 4000, 2000)   # two 2 km wards (metres)
    roads = [("primary", LineString([(0, 1000), (4000, 1000)])),   # 2 km in each ward
             ("residential", LineString([(2500, 0), (2500, 500)]))]   # 0.5 km, ward b only
    (ma, aa), (mb, ab) = ch.ward_road_km([a, b], roads)
    assert (round(ma, 3), round(aa, 3), round(mb, 3), round(ab, 3)) == (2.0, 2.0, 2.0, 2.5)
    assert ch.growth_per_road_km(10, ma) == 5.0
    assert ch.growth_per_road_km(3, 0.0) == 6.0   # floor 0.5 km


def test_rectness_rect_vs_ring():
    r = np.argwhere(np.ones((10, 20), bool))
    assert ch.rectness(r) > 0.99
    t = np.argwhere(np.tri(20, dtype=bool))   # triangle ~0.5
    assert ch.rectness(t) < 0.65


def test_find_pits_new_rect_kept_seasonal_edge_dropped():
    w0 = np.zeros((60, 60), bool)
    w1 = w0.copy()
    w1[10:20, 10:30] = True                       # new 2 ha rectangle
    w0[35:55, 5:25] = True
    w1[35:55, 5:25] = True
    w1[30:35, 5:25] = True                        # big water body whose edge moved: > 5 ha? 25x20=5 ha, merged, not new
    ones = np.ones_like(w1)
    thr = {**ch.DEFAULTS["sand"], "pit_max_ha": 3.0}
    lab, pits = ch.find_pits(w0, w1, ones, ones, thr, ~w1)
    assert len(pits) == 1 and pits[0]["new"] and abs(pits[0]["ha"] - 2.0) < 0.01


def test_crop_window_stays_in_grid():
    from herald.change import G
    from herald.crops import window
    assert window(0, 0) == (0, 0)
    assert window(G - 1, G - 1) == (G - 3, G - 3)
    assert window(10, 20) == (9, 19)
