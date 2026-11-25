
import numpy as np
from shapely.geometry import LineString, Point

from herald import siting as st

CFG = st.load_cfg()


def cells(n=2, **kw):
    wc = np.zeros((n, n, 11))
    wc[..., 5] = 1.0                                   # all bare
    c = dict(wc=wc, prot=np.zeros((n, n)), f5=np.ones((n, n)), f15=np.ones((n, n)), ghi=np.full((n, n), 5.0),
             ws50=np.full((n, n), 6.0), d_sub=np.full((n, n), 10.0), t2m=np.full((n, n), 5.0), road_km=np.zeros((n, n)), road_km_blade=np.zeros((n, n)))
    c.update(kw)
    return c


def test_solar_math():
    r = st.solar(cells(), CFG)
    S = CFG["solar"]
    assert np.allclose(r["mw"], 100 / S["ha_per_mw"]["v"])
    cuf = 5 * 365 * S["pr"]["v"] / 8760
    assert np.allclose(r["cuf"], cuf) and np.allclose(r["mwh"], r["mw"] * 8760 * cuf)
    assert np.allclose(r["rev"], r["mwh"] * 1000 * S["tariff_rs_kwh"]["v"])
    far = st.solar(cells(d_sub=np.full((2, 2), 50.0)), CFG)
    assert (far["net"] < r["net"]).all()               # grid distance costs money


def test_exclusions_and_slope():
    c = cells()
    c["wc"][0, 0] = 0
    c["wc"][0, 0, 0] = .6           # tree 60%
    c["wc"][0, 1] = 0
    c["wc"][0, 1, 7] = .6           # water
    c["prot"][1, 0] = .8                               # protected
    c["f5"][1, 1] = 0                                  # too steep
    r = st.solar(c, CFG)
    assert np.isnan(r["score"][0, 0]) and np.isnan(r["score"][0, 1]) and np.isnan(r["score"][1, 0])
    assert np.isnan(r["score"][1, 1])                  # zero usable ha
    b = cells()
    b["wc"][0, 0] = 0
    b["wc"][0, 0, 4] = 1
    assert np.isnan(st.solar(b, CFG)["score"][0, 0])
    assert not np.isnan(st.solar(b, CFG, built_ok=np.array([[True, False], [False, False]]))["score"][0, 0])


def test_wind_threshold_and_cuf():
    c = cells(ws50=np.array([[5.0, 7.0], [7.0, 9.0]]))
    r = st.wind(c, CFG)
    assert np.isnan(r["score"][0, 0]) and not np.isnan(r["score"][0, 1])
    assert r["cuf"][0, 0] < r["cuf"][0, 1] < r["cuf"][1, 1] < 1


def test_distance_and_percentile():
    x, y = np.array([[0., 3000.]]), np.array([[0., 4000.]])
    assert np.allclose(st.nearest_km(x, y, [Point(0, 0)]), [[0, 5]])
    assert np.allclose(st.nearest_km(x, y, [LineString([(0, 4000), (9000, 4000)])]), [[4, 0]])
    assert np.isinf(st.nearest_km(x, y, [])).all()
    s = np.array([[1., 2.], [3., np.nan]])
    assert st.pct(s, np.array([[False, False], [True, False]]))["mean_pct"] == round(2 / 3 * 100, 1)
    assert st.top_idx(s, 2) == [2, 1]


def test_lcoe_formula():
    S = CFG["solar"]
    r = st.solar(cells(d_sub=np.zeros((2, 2))), CFG)
    w, n = S["wacc"]["v"], S["life_yr"]["v"]
    crf = w / (1 - (1 + w) ** -n)
    exp = (S["capex_cr_per_mw"]["v"] * 1e7 * crf + S["om_lakh_per_mw_yr"]["v"] * 1e5) / (r["mwh"] / r["mw"] * 1000)
    assert np.allclose(r["lcoe"], exp) and np.allclose(r["score"], -exp)


def test_heat_derate_and_road_cost():
    S = CFG["solar"]
    assert np.isclose(st.pr_adj(np.array(5.0), S), S["pr"]["v"])                      # T_cell 25 C: no derate
    assert np.isclose(st.pr_adj(np.array(25.0), S), S["pr"]["v"] * (1 - 0.004 * 20))   # T_cell 45 C
    a, b = st.solar(cells(), CFG), st.solar(cells(road_km=np.full((2, 2), 4.0)), CFG)
    w, n = S["wacc"]["v"], S["life_yr"]["v"]
    crf = w / (1 - (1 + w) ** -n)
    assert np.allclose((b["lcoe"] - a["lcoe"]) * a["mwh"] * 1000, 4.0 * S["road_cr_per_km"]["v"] * 1e7 * crf)


def test_clusters():
    r = dict(score=np.array([[-2., np.nan, -2.], [np.nan, -2., np.nan]]), lcoe=np.array([[2., 9, 2.], [9, 2., 9]]), mw=np.full((2, 3), 10.))
    mw, lab = st.clusters(r, CFG["solar"], 2.6)
    assert (mw == [[30, 0, 30], [0, 30, 0]]).all()                                   # diagonal neighbours join
