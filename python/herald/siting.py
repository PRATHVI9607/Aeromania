"""Renewable siting: rank 1 km cells in a 60x60 km box around Pavagada for solar and wind.

usage: python -m herald siting [--refetch]
Fetch (network, cached in vault/siting/): NASA POWER, Copernicus DEM, WorldCover, OSM Overpass. Rest is offline.
Writes reports/siting.json, web/public/data/siting.json, web/public/data/img/siting_{solar,wind}.png.
All parameters + sources live in config/siting.json.
"""
import json
import sys
import time

import numpy as np
import requests
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from shapely import distance as sdist
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import polygonize, unary_union, transform as shp_transform

from herald.labels import WC_URL, wc_tile_names
from herald.paths import CONFIG, REPORTS, VAULT, WEB_DATA, ensure

CACHE = VAULT / "siting"
N, DEM_PX, WC_PX = 60, 25, 10          # cells per side; DEM and WorldCover pixel sizes (m)
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{n}_00_{e}_00_DEM/Copernicus_DSM_COG_10_{n}_00_{e}_00_DEM.tif"
WCI = dict(tree=0, shrub=1, grass=2, crop=3, built=4, bare=5, water=7, wetland=8, mangrove=9)
WC_CLASSES = (10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100)


def log(*a):
    print("[siting]", *a, flush=True)


def load_cfg():
    return json.loads((CONFIG / "siting.json").read_text(encoding="utf-8"))


def grid(cfg):
    """UTM origin of the 60x60 km box + transformers."""
    r = cfg["region"]
    to_utm = Transformer.from_crs(4326, r["utm_epsg"], always_xy=True)
    to_ll = Transformer.from_crs(r["utm_epsg"], 4326, always_xy=True)
    cx, cy = to_utm.transform(r["center_lon"], r["center_lat"])
    half = r["size_km"] * 500
    return dict(x0=cx - half, y1=cy + half, to_utm=to_utm, to_ll=to_ll, epsg=r["utm_epsg"])


def centres(g):
    j, i = np.meshgrid(np.arange(N), np.arange(N))        # i = row (north->south), j = col
    x, y = g["x0"] + (j + .5) * 1000, g["y1"] - (i + .5) * 1000
    lon, lat = g["to_ll"].transform(x, y)
    return x, y, lat, lon


# ---------------------------------------------------------------- fetch (cached)
def overpass(q):
    last = None
    for url in OVERPASS * 2:
        try:
            r = requests.post(url, data={"data": q}, timeout=180, headers={"User-Agent": "herald-siting/0.1"})
            r.raise_for_status()
            return r.json()["elements"]
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(30)
    raise RuntimeError(f"overpass failed: {last}")


def fetch(cfg, g, force=False):
    ensure(CACHE)
    _, _, lat, lon = centres(g)
    s, n, w, e = lat.min() - .005, lat.max() + .005, lon.min() - .005, lon.max() + .005
    m = cfg["region"]["margin_km_grid"] / 111
    wide = f"{s - m},{w - m},{n + m},{e + m}"
    box = f"{s},{w},{n},{e}"
    # NASA POWER: 4x4 points, 0.25 deg spacing, covers the box
    f = CACHE / "power.json"
    if force or not f.exists():
        lats, lons = np.arange(13.75, 14.51, .25), np.arange(77.0, 77.76, .25)
        pts = []
        for la in lats:
            for lo in lons:
                u = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,WS50M"
                     f"&community=RE&longitude={lo}&latitude={la}&format=JSON")
                p = requests.get(u, timeout=60).json()["properties"]["parameter"]
                pts.append(dict(lat=float(la), lon=float(lo), ghi=p["ALLSKY_SFC_SW_DWN"]["ANN"], ws50=p["WS50M"]["ANN"]))
        f.write_text(json.dumps(dict(lats=lats.tolist(), lons=lons.tolist(), pts=pts)), encoding="utf-8")
        log("power fetched")
    # DEM 25 m, UTM grid
    f = CACHE / "dem.npy"
    if force or not f.exists():
        tr, S = from_origin(g["x0"], g["y1"], DEM_PX, DEM_PX), N * 1000 // DEM_PX
        dem = np.full((S, S), np.nan, np.float32)
        for la in range(int(np.floor(s)), int(np.floor(n)) + 1):
            for lo in range(int(np.floor(w)), int(np.floor(e)) + 1):
                url = DEM_URL.format(n=f"N{la:02d}", e=f"E{lo:03d}")
                with rasterio.Env(AWS_NO_SIGN_REQUEST="YES"), rasterio.open(url) as src, \
                        WarpedVRT(src, crs=f"EPSG:{g['epsg']}", transform=tr, width=S, height=S,
                                  resampling=Resampling.bilinear, nodata=np.nan) as v:
                    a = v.read(1).astype(np.float32)
                dem = np.where(np.isnan(dem), a, dem)
        np.save(f, dem)
        log("dem fetched")
    f = CACHE / "wc.npy"
    if force or not f.exists():
        tr, S = from_origin(g["x0"], g["y1"], WC_PX, WC_PX), N * 1000 // WC_PX
        wc = np.zeros((S, S), np.uint8)
        for name in wc_tile_names(w, s, e, n):
            with rasterio.Env(AWS_NO_SIGN_REQUEST="YES"), rasterio.open(WC_URL.format(name)) as src, \
                    WarpedVRT(src, crs=f"EPSG:{g['epsg']}", transform=tr, width=S, height=S,
                              resampling=Resampling.nearest, src_nodata=0, nodata=0) as v:
                wc = np.where(wc == 0, v.read(1), wc)
        np.save(f, wc)
        log("worldcover fetched")
    for name, q in dict(
        lines=f'[out:json][timeout:150];way["power"="line"]({wide});out geom tags;',
        subs=f'[out:json][timeout:150];nwr["power"="substation"]({wide});out geom tags;',
        solar=f'[out:json][timeout:150];(nwr["generator:source"="solar"]({box});nwr["power"="plant"]["plant:source"="solar"]({box});'
              f'nwr["power"="generator"]["generator:source"="solar"]({box}););out geom tags;',
        prot=f'[out:json][timeout:150];(nwr["boundary"="protected_area"]({box});nwr["leisure"="nature_reserve"]({box}););out geom tags;',
    ).items():
        f = CACHE / f"osm_{name}.json"
        if force or not f.exists():
            f.write_text(json.dumps(overpass(q)), encoding="utf-8")
            log("osm", name, "fetched")
            time.sleep(10)


# ---------------------------------------------------------------- features
def osm_geoms(elements, area=False):
    """OSM elements -> list of (shapely geom in lon/lat, tags). area=True closes ways to polygons."""
    out = []
    for el in elements:
        t = el.get("tags", {})
        if el["type"] == "node":
            out.append((Point(el["lon"], el["lat"]), t))
        elif el["type"] == "way" and len(el.get("geometry", [])) >= 2:
            c = [(p["lon"], p["lat"]) for p in el["geometry"]]
            out.append((Polygon(c) if area and len(c) >= 4 and c[0] == c[-1] else LineString(c), t))
        elif el["type"] == "relation":
            ws = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]]) for m in el.get("members", [])
                  if m.get("geometry") and len(m["geometry"]) >= 2 and m.get("role") in ("outer", "")]
            ps = list(polygonize(unary_union(ws))) if ws else []
            if ps:
                out.append((unary_union(ps), t))
    return out


def to_utm(geoms, g):
    return [shp_transform(g["to_utm"].transform, x) for x in geoms]


def volt(t):
    try:
        return max(int(v) for v in t.get("voltage", "").replace(",", ";").split(";") if v.strip().isdigit())
    except ValueError:
        return 0


def nearest_km(x, y, geoms):
    """Distance (km) from each point to nearest of shapely geoms (UTM metres). inf if none."""
    if not geoms:
        return np.full(x.shape, np.inf)
    u = unary_union(geoms)
    return sdist(np.array([Point(a, b) for a, b in zip(x.ravel(), y.ravel())]), u).reshape(x.shape) / 1000


def cover(geoms, g, px=100):
    """Fraction of each 1 km cell covered by UTM polygons (rasterised at px m)."""
    S = N * 1000 // px
    if not geoms:
        return np.zeros((N, N))
    r = rasterize([(x, 1) for x in geoms], (S, S), transform=from_origin(g["x0"], g["y1"], px, px), dtype="uint8")
    return r.reshape(N, S // N, N, S // N).mean(axis=(1, 3))


def features(cfg, g):
    x, y, lat, lon = centres(g)
    P = json.loads((CACHE / "power.json").read_text(encoding="utf-8"))
    from scipy.interpolate import RegularGridInterpolator as RGI
    nl, no = len(P["lats"]), len(P["lons"])
    ip = lambda k: RGI((P["lats"], P["lons"]), np.array([p[k] for p in P["pts"]]).reshape(nl, no))(np.c_[lat.ravel(), lon.ravel()]).reshape(N, N)
    dem = np.load(CACHE / "dem.npy")
    dem = np.where(np.isnan(dem), np.nanmean(dem), dem)
    gy, gx = np.gradient(dem, DEM_PX)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    blk = lambda a: a.reshape(N, a.shape[0] // N, N, a.shape[1] // N).mean(axis=(1, 3))
    wc = np.load(CACHE / "wc.npy")
    wcf = np.stack([blk((wc == c).astype(np.float32)) for c in WC_CLASSES], axis=-1)
    el = lambda n: json.loads((CACHE / f"osm_{n}.json").read_text(encoding="utf-8"))
    lines = [(geo, volt(t)) for geo, t in osm_geoms(el("lines"))]
    subs = [geo.centroid for geo, _ in osm_geoms(el("subs"), area=True)]
    solar = osm_geoms(el("solar"), area=True)
    prot = [geo for geo, _ in osm_geoms(el("prot"), area=True) if geo.geom_type in ("Polygon", "MultiPolygon")]
    return dict(
        x=x, y=y, lat=lat, lon=lon, ghi=ip("ghi"), ws50=ip("ws50"), slope=blk(slope), f5=blk(slope < 5), f15=blk(slope < 15),
        wc=wcf, d_sub=nearest_km(x, y, to_utm(subs, g)),
        d_l33=nearest_km(x, y, to_utm([a for a, v in lines if v >= 33000], g)),
        prot=np.clip(cover(to_utm(prot, g), g), 0, 1),
        solar_cover=cover(to_utm([a for a, _ in solar if a.geom_type in ("Polygon", "MultiPolygon") and a.area > 0], g), g),
        solar_pts=[g["to_utm"].transform(a.centroid.x, a.centroid.y) for a, _ in solar],
        solar_poly_ha=sum(p.area for p in to_utm([a for a, _ in solar if a.geom_type in ("Polygon", "MultiPolygon")], g)) / 1e4,
        n_sub=len(subs), n_line33=sum(v >= 33000 for _, v in lines),
    )


# ---------------------------------------------------------------- scoring (pure, tested)
def excluded(c, P, built_ok=None):
    """True where a cell cannot host any project."""
    w, ex = c["wc"], P["exclusion"]
    built = w[..., WCI["built"]] * (1 if built_ok is None else ~built_ok)
    bad = w[..., WCI["water"]] + w[..., WCI["wetland"]] + w[..., WCI["mangrove"]] + built
    return (w[..., WCI["tree"]] > ex["tree_frac"]["v"]) | (bad > ex["unusable_frac"]["v"]) | (c["prot"] > ex["unusable_frac"]["v"])


def landshare(c, wts, built_ok=None):
    s = sum(w * c["wc"][..., WC_CLASSES.index(int(k))] for k, w in wts.items())
    if built_ok is not None:
        s = s + built_ok * c["wc"][..., WCI["built"]]
    return s * (1 - c["prot"])


def econ(mw, mwh, S, grid_km):
    rev = mwh * 1000 * S["tariff_rs_kwh"]["v"]
    w, n = S["wacc"]["v"], S["life_yr"]["v"]
    crf = w / (1 - (1 + w) ** -n)
    cost = mw * (S["om_lakh_per_mw_yr"]["v"] * 1e5 + S["capex_cr_per_mw"]["v"] * 1e7 * crf) + grid_km * S["grid_cr_per_km"]["v"] * 1e7 * crf
    lcoe = cost / np.maximum(mwh * 1000, 1e-9)
    return rev, rev - cost, lcoe


def solar(c, P, built_ok=None):
    """dict of arrays; score = -LCOE (Rs/kWh), higher = better; NaN if excluded or < min MW."""
    S = P["solar"]
    ha = 100 * landshare(c, S["weights"]["v"], built_ok) * c["f5"]
    mw = ha / S["ha_per_mw"]["v"]
    cuf = c["ghi"] * 365 * S["pr"]["v"] / 8760
    mwh = mw * 8760 * cuf
    rev, net, lcoe = econ(mw, mwh, S, c["d_sub"])
    ok = ~excluded(c, P, built_ok) & (mw >= S["min_project_mw"]["v"])
    return dict(ha=ha, mw=mw, cuf=cuf, mwh=mwh, rev=rev, net=net, lcoe=lcoe, score=np.where(ok, -lcoe, np.nan))


def wind_cuf(ws50, W):
    """Capacity factor from Rayleigh wind distribution at hub height through a generic cubic power curve."""
    pc = W["power_curve"]
    v = np.linspace(0, 30, 601)
    p = np.clip(((v ** 3 - pc["cut_in"] ** 3) / (pc["rated"] ** 3 - pc["cut_in"] ** 3)), 0, 1)
    p = np.where((v < pc["cut_in"]) | (v > pc["cut_out"]), 0, p)
    m = np.asarray(ws50)[..., None] * 2 ** W["hub_alpha"]["v"]
    pdf = np.pi / 2 * v / m ** 2 * np.exp(-np.pi * v ** 2 / (4 * m ** 2))
    return (pdf * p).sum(-1) * (v[1] - v[0]) * W["loss_factor"]["v"]


def wind(c, P):
    W = P["wind"]
    km2 = landshare(c, W["weights"]["v"]) * c["f15"]
    mw = km2 * W["mw_per_km2"]["v"]
    cuf = wind_cuf(c["ws50"], W)
    mwh = mw * 8760 * cuf
    rev, net, lcoe = econ(mw, mwh, W, c["d_sub"])
    ok = ~excluded(c, P) & (mw >= W["min_project_mw"]["v"]) & (c["ws50"] >= W["min_ws50"]["v"])
    return dict(km2=km2, mw=mw, cuf=cuf, mwh=mwh, rev=rev, net=net, lcoe=lcoe, score=np.where(ok, -lcoe, np.nan))


def pct(score, mask):
    """Mean percentile (0-100) of masked cells among all ranked (non-NaN) cells; also share of them in the top decile."""
    ref = score[~np.isnan(score)]
    m = score[mask & ~np.isnan(score)]
    if not len(m):
        return dict(n_cells=int(mask.sum()), n_ranked=0, mean_pct=None, median_pct=None, share_top_decile=None)
    p = np.array([(ref < s).mean() * 100 for s in m])
    return dict(n_cells=int(mask.sum()), n_ranked=len(m), mean_pct=round(float(p.mean()), 1),
                median_pct=round(float(np.median(p)), 1), share_top_decile=round(float((p >= 90).mean()), 3))


def top_idx(score, k=20):
    s = np.where(np.isnan(score), -np.inf, score).ravel()
    i = np.argsort(-s)[:k]
    return [int(a) for a in i if np.isfinite(s[a])]


# ---------------------------------------------------------------- outputs
def record(c, r, k, kind, rank):
    i, j = divmod(k, N)
    w = c["wc"][i, j]
    mix = {n: round(float(w[WCI[n]]), 2) for n in WCI if w[WCI[n]] >= .01}
    reasons = []
    if kind == "solar":
        reasons += [f"GHI {c['ghi'][i, j]:.2f} kWh/m2/day -> CUF {r['cuf'][i, j]:.3f}", f"{r['ha'][i, j]:.0f} usable ha (flat, usable land)"]
    else:
        reasons += [f"WS50M {c['ws50'][i, j]:.2f} m/s -> CUF {r['cuf'][i, j]:.3f}", f"{r['km2'][i, j]:.2f} km2 developable (slope<15 deg)"]
    reasons.append(f"{c['d_sub'][i, j]:.1f} km to substation, {c['d_l33'][i, j]:.1f} km to >=33 kV line")
    return dict(rank=rank, lat=round(float(c["lat"][i, j]), 4), lon=round(float(c["lon"][i, j]), 4), mw=round(float(r["mw"][i, j]), 1),
                mwh_yr=round(float(r["mwh"][i, j])), revenue_rs_yr=round(float(r["rev"][i, j])), net_value_rs_yr=round(float(r["net"][i, j])), net_value_rs_per_mw_yr=round(float(r["net"][i, j] / max(r["mw"][i, j], 1e-9))), lcoe_rs_kwh=round(float(r["lcoe"][i, j]), 2),
                grid_km_substation=round(float(c["d_sub"][i, j]), 1), grid_km_line33=round(float(c["d_l33"][i, j]), 1),
                slope_mean_deg=round(float(c["slope"][i, j]), 1), land_mix=mix, reasons=reasons)


def heat(score, path):
    from PIL import Image
    v = np.full(score.shape, np.nan)
    ok = ~np.isnan(score)
    v[ok] = score[ok].argsort().argsort() / max(ok.sum() - 1, 1)     # rank-normalised 0..1
    lo, mid, hi = np.array([68, 1, 84]), np.array([33, 145, 140]), np.array([253, 231, 37])
    t = np.nan_to_num(v)[..., None]
    rgb = np.where(t < .5, lo + (mid - lo) * t * 2, mid + (hi - mid) * (t - .5) * 2)
    img = np.dstack([rgb, np.where(ok, 200, 0)]).astype(np.uint8)
    Image.fromarray(img, "RGBA").resize((N * 10, N * 10), Image.NEAREST).save(path)


def main(argv=None):
    force = "--refetch" in (argv or [])
    cfg = load_cfg()
    g = grid(cfg)
    fetch(cfg, g, force)
    c = features(cfg, g)
    S, W = solar(c, cfg), wind(c, cfg)
    cell_ha = 100.0

    # validation 1/2: OSM solar footprints
    park = c["solar_cover"] >= cfg["validation"]["park_cell_min_cover"]["v"]
    pts = {(int((g["y1"] - yy) // 1000), int((xx - g["x0"]) // 1000)) for xx, yy in c["solar_pts"]}
    small = np.zeros((N, N), bool)
    for i, j in pts:
        if 0 <= i < N and 0 <= j < N:
            small[i, j] = True
    small &= ~park
    Sb = solar(c, cfg, built_ok=park)        # park cells: WorldCover may label panels as built/bare -> treat as available
    val = dict(
        pavagada_park=dict(footprint_polygon_ha=round(float(c["solar_poly_ha"])), reference_ha=round(13000 * 0.4047), cells=int(park.sum()),
                           as_is=pct(S["score"], park), built_treated_as_available=pct(Sb["score"], park),
                           note="Cells with >=25% inside OSM solar polygons. Second row waives the 'built' exclusion/weight on those cells because WorldCover 2021 may label panels as built; this is applied to park cells only."),
        other_osm_solar=dict(as_is=pct(S["score"], small), note="Cells holding OSM solar generators (points/small ways) outside the park cells; small n, mapping is patchy."),
    )
    # validation 3: sensitivity
    def variant(hpm=None, capex=None):
        P = json.loads(json.dumps(cfg))
        if hpm:
            P["solar"]["ha_per_mw"]["v"] = hpm
        if capex:
            P["solar"]["capex_cr_per_mw"]["v"] = capex
        return solar(c, P)["score"]
    base = set(top_idx(S["score"]))
    tariff = cfg["solar"]["tariff_rs_kwh"]["v"]
    viable = lambda sc: int((-sc[~np.isnan(sc)] < tariff).sum())
    cases = {"capex low": (None, cfg["solar"]["capex_cr_per_mw"]["lo"]), "capex base": (None, None), "capex high": (None, cfg["solar"]["capex_cr_per_mw"]["hi"]),
             "ha_per_mw 1.6": (1.6, None), "ha_per_mw 2.0": (2.0, None)}
    sc = {k: variant(*a) for k, a in cases.items()}
    val["sensitivity"] = dict(
        top20_overlap_with_base={k: len(base & set(top_idx(v))) for k, v in sc.items()},
        viable_cells_lcoe_below_tariff={k: viable(v) for k, v in sc.items()},
        viable_tariff_minus20pct=int((-S["score"][~np.isnan(S["score"])] < tariff * .8).sum()),
        viable_tariff_plus20pct=int((-S["score"][~np.isnan(S["score"])] < tariff * 1.2).sum()),
        note="Ranking is by LCOE so tariff does not change the order, only which cells are viable (LCOE < tariff).")
    val["pavagada_lcoe_percentiles_note"] = "percentile = share of ranked cells with higher LCOE"

    tot = lambda r: dict(ranked_cells=int((~np.isnan(r["score"])).sum()), mw=round(float(np.nansum(np.where(np.isnan(r["score"]), np.nan, r["mw"])))),
                         mwh_yr=round(float(np.nansum(np.where(np.isnan(r["score"]), np.nan, r["mwh"])))),
                         revenue_rs_yr=round(float(np.nansum(np.where(np.isnan(r["score"]), np.nan, r["rev"])))))
    ts, tw = top_idx(S["score"]), top_idx(W["score"])
    wv = W["lcoe"][~np.isnan(W["score"])]
    wind_note = dict(status=cfg["wind"]["status"], ranked=int(len(wv)), viable_lcoe_below_wind_tariff=int((wv < cfg["wind"]["tariff_rs_kwh"]["v"]).sum()))
    params = {k: cfg[k] for k in ("solar", "wind", "exclusion", "sources")}
    rep = dict(
        bbox=[round(float(v), 4) for v in (c["lon"].min() - .0045, c["lat"].min() - .0045, c["lon"].max() + .0045, c["lat"].max() + .0045)],
        caveats=["NASA POWER irradiance/wind is native ~0.5-1 deg: only 16 sample points, cell values are smooth interpolation, ridge-top wind NOT resolved (Global Wind Atlas would be the upgrade).",
                 "Slope-share and land-use share are multiplied as if independent.", "All Rs numbers are assumptions (config/siting.json).",
                 "Substation distance is a straight-line proxy; no capacity, voltage-level or land-ownership data."],
        region_totals=dict(wind_status=wind_note, solar=tot(S), wind=tot(W), n_substations=c["n_sub"], n_lines_ge33kv=c["n_line33"], n_cells_excluded=int(excluded(c, cfg).sum())),
        top_solar=[record(c, S, k, "solar", n + 1) for n, k in enumerate(ts)], top_wind=[record(c, W, k, "wind", n + 1) for n, k in enumerate(tw)],
        params=params, validation=val)
    ensure(REPORTS, WEB_DATA / "img")
    (REPORTS / "siting.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")

    def pr(s):   # 0 = not ranked, else 1..100 percentile rank
        o = np.zeros(s.shape, int)
        ok = ~np.isnan(s)
        o[ok] = 1 + np.round(99 * s[ok].argsort().argsort() / max(ok.sum() - 1, 1))
        return o
    ps, pw = pr(S["score"]), pr(W["score"])
    web = dict(bbox=rep["bbox"], n=N, cell_km=1, params=dict(solar=dict(tariff=cfg["solar"]["tariff_rs_kwh"]["v"], ha_per_mw=cfg["solar"]["ha_per_mw"]["v"]),
               wind=dict(min_ws50=cfg["wind"]["min_ws50"]["v"], mw_per_km2=cfg["wind"]["mw_per_km2"]["v"]), note="all Rs values are assumptions, see reports/siting.json"),
               cells=[dict(lat=round(float(c["lat"][i, j]), 3), lon=round(float(c["lon"][i, j]), 3), solar_score=int(ps[i, j]), wind_score=int(pw[i, j]),
                           ghi=round(float(c["ghi"][i, j]), 2), ws50=round(float(c["ws50"][i, j]), 2), slope=round(float(c["slope"][i, j]), 1))
                      for i in range(N) for j in range(N)],
               top_solar=rep["top_solar"], top_wind=rep["top_wind"], validation=val,
               images=dict(solar="img/siting_solar.png", wind="img/siting_wind.png"), caveats=rep["caveats"])
    (WEB_DATA / "siting.json").write_text(json.dumps(web, separators=(",", ":")), encoding="utf-8")
    heat(S["score"], WEB_DATA / "img" / "siting_solar.png")
    heat(W["score"], WEB_DATA / "img" / "siting_wind.png")
    log("totals", rep["region_totals"])
    log("validation", json.dumps(val))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
