"""Orbit + contact windows (PRD s9). Offline: synthetic TLE for a Sentinel-2-like SSO.

`python -m herald orbit [--days N]` writes web/public/data/{track,windows}.json.
"""
import argparse
import functools
import json
import math

import numpy as np
from skyfield.api import EarthSatellite, load, wgs84

from herald.paths import CONFIG, WEB_DATA, ensure

MU = 398600.4418       # km^3/s^2
RE = 6378.137          # km
ALT_KM, INC, SWATH_KM, LTDN_H = 786.0, 98.62, 290.0, 10.5
EPOCH = (2025, 1, 15)
MIN_EL = 10.0
LINK_MBPS, EFF = 100, 0.7
ts = load.timescale()


def _cks(line):
    return sum(int(c) if c.isdigit() else (c == "-") for c in line) % 10


def sun_ra_deg(d=9145.5):   # d = days since J2000 of 2025-01-15 00:00 UTC
    L = 280.460 + 0.9856474 * d
    g = math.radians(357.528 + 0.9856003 * d)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    return math.degrees(math.atan2(math.cos(math.radians(23.44)) * math.sin(lam), math.cos(lam))) % 360


def make_tle():
    """Synthetic TLE: circular 786 km, 98.62 deg; RAAN set so the descending node is at 10:30 local mean solar time."""
    a = RE + ALT_KM
    mm = 86400 / (2 * math.pi * math.sqrt(a**3 / MU))                  # rev/day
    raan = (sun_ra_deg() + LTDN_H * 15) % 360   # asc node at 22:30 local (desc 10:30) = sunRA + 10.5 h * 15
    l1 = "1 99999U 25001A   25015.00000000  .00000000  00000-0  00000-0 0  999"
    l2 = f"2 99999 {INC:8.4f} {raan:8.4f} 0001000 {90:8.4f} {0:8.4f} {mm:11.8f}{1:5d}"
    assert len(l1) == 68 and len(l2) == 68, (len(l1), len(l2))
    return l1 + str(_cks(l1)), l2 + str(_cks(l2)), mm


def satellite():
    l1, l2, _ = make_tle()
    return EarthSatellite(l1, l2, "HERALD-SSO", ts)


def t0():
    return ts.utc(*EPOCH)


def times(t_min):
    return ts.utc(*EPOCH, 0, np.asarray(t_min, dtype=float))


def stations():
    return json.loads((CONFIG / "stations.json").read_text(encoding="utf-8"))["stations"]


def windows(days=5):
    sat, end, out = satellite(), times(days * 1440), []
    for s in stations():
        topo = wgs84.latlon(s["lat"], s["lon"], elevation_m=s["elev_m"])
        t, ev = sat.find_events(topo, t0(), end, altitude_degrees=MIN_EL)
        rise = None
        for ti, e in zip(t, ev, strict=True):
            tm = (ti.tt - t0().tt) * 1440
            if e == 0:
                rise, peak = tm, 0.0
            elif e == 1 and rise is not None:
                peak = float((sat - topo).at(ti).altaz()[0].degrees)
            elif e == 2 and rise is not None:
                out.append({"station": s["id"], "start_min": round(rise, 3), "end_min": round(tm, 3),
                            "dur_min": round(tm - rise, 3), "max_el": round(peak, 1)})
                rise = None
    out.sort(key=lambda w: (w["start_min"], w["station"]))
    for i, w in enumerate(out):
        w["id"] = i
        w["bytes"] = int(w["dur_min"] * 60 * LINK_MBPS * 1e6 / 8 * EFF)   # unscaled link capacity
    return out


def subpoints(t_min):
    g = wgs84.subpoint(satellite().at(times(t_min)))
    return g.latitude.degrees, g.longitude.degrees, g.elevation.km


def track(days=5, step_s=30):
    tm = np.arange(0, days * 1440, step_s / 60)
    lat, lon, alt = subpoints(tm)
    return {"step_s": step_s, "t0_utc": "2025-01-15T00:00:00Z",   # t_min[i] = i * step_s / 60
            "lon": np.round(lon, 2).tolist(), "lat": np.round(lat, 2).tolist(), "alt_km": np.round(alt, 0).astype(int).tolist()}


def _hav(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), math.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * math.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * RE * np.arcsin(np.sqrt(a))


@functools.lru_cache(maxsize=1)
def _cycle(days, step_s):
    tm = np.arange(0, days * 1440, step_s / 60)
    return (tm, *subpoints(tm))


def overpasses(center, days=10, step_s=10):
    """Daytime passes whose ground track comes within half the swath of `center` (lat, lon).
    10 days = repeat cycle (143 orbits) so every point is covered at least once."""
    tm, lat, lon, _ = _cycle(days, step_s)
    d = _hav(lat, lon, *center)
    solar_h = ((tm / 60 + lon / 15) % 24)
    k = np.where((d[1:-1] < d[:-2]) & (d[1:-1] <= d[2:]) & (d[1:-1] < SWATH_KM / 2) & (np.abs(solar_h[1:-1] - LTDN_H) < 2))[0] + 1
    return [{"t_min": round(float(tm[i]), 2), "cross_track_km": round(float(d[i]), 1)} for i in k]


def physics(wins):
    a = RE + ALT_KM
    mm = make_tle()[2]
    tm = np.arange(0, 1440, 0.25)
    lat, _, alt = subpoints(tm)
    up = np.where((lat[:-1] < 0) & (lat[1:] >= 0))[0]            # ascending node crossings
    nodal = float(np.mean(np.diff(tm[up]))) if len(up) > 1 else float("nan")
    mx = float(max((w["dur_min"] for w in wins), default=0.0))
    return {"period_kepler_min": round(2 * math.pi * math.sqrt(a**3 / MU) / 60, 2),
            "period_tle_min": round(1440 / mm, 2), "period_nodal_measured_min": round(nodal, 2),
            "prd_period_min": 100.43, "note": "PRD 100.43 is not what a 786 km circular orbit gives; computed value reported.",
            "inclination_deg": INC, "mean_alt_km": round(float(alt.mean()), 1),
            "max_pass_min": round(mx, 2), "prd_max_pass_min": 10.47,
            "gb_per_max_pass": round(mx * 60 * LINK_MBPS * 1e6 / 8 * EFF / 1e9, 2), "prd_gb_per_max_pass": 5.51,
            "swath_km": SWATH_KM}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="herald orbit")
    ap.add_argument("cmd", nargs="?")
    ap.add_argument("--days", type=int, default=5, help="5 (not 3) so a 3-day capture replay still has downlink windows after it")
    a = ap.parse_args(argv)
    ensure(WEB_DATA)
    w = windows(a.days)
    (WEB_DATA / "windows.json").write_text(json.dumps({"epoch_utc": "2025-01-15T00:00:00Z", "min_el": MIN_EL, "windows": w}), encoding="utf-8")
    tr = track(a.days)
    (WEB_DATA / "track.json").write_text(json.dumps(tr, separators=(",", ":")), encoding="utf-8")
    print(f"{len(w)} windows, {len(tr['lon'])} track pts; {physics(w)}")
    return 0
