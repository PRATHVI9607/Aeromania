import numpy as np

from herald import orbit


def test_tle_and_physics():
    l1, l2, mm = orbit.make_tle()
    assert len(l1) == len(l2) == 69
    w = orbit.windows(2)
    p = orbit.physics(w)
    assert 100.4 < p["period_tle_min"] < 100.8 and abs(p["period_nodal_measured_min"] - p["period_tle_min"]) < 0.3
    assert p["inclination_deg"] == 98.62
    assert 9.5 < p["max_pass_min"] < 11.5
    assert abs(p["gb_per_max_pass"] - p["max_pass_min"] * 60 * 8.75e6 / 1e9) < 0.01


def test_windows_min_elevation_and_sso_inclination():
    w = orbit.windows(2)
    assert w and all(x["max_el"] >= orbit.MIN_EL and x["end_min"] > x["start_min"] for x in w)
    assert {x["station"] for x in w} >= {"svalbard", "bengaluru"}
    lat, _, alt = orbit.subpoints(np.arange(0, 200, 1.0))
    assert abs(lat).max() > 81 and 770 < alt.mean() < 830     # retrograde SSO reaches ~81.4 deg latitude


def test_overpass_in_swath_and_daytime():
    ov = orbit.overpasses((22.82, 82.68))
    assert ov and all(o["cross_track_km"] < orbit.SWATH_KM / 2 for o in ov)
