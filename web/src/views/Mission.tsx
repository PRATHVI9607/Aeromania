import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BillboardCollection, BoxGeometry, Cartesian2, Cartesian3, Color, ConstantPositionProperty, DistanceDisplayCondition, EasingFunction, EllipsoidGeometry, GeometryInstance, HorizontalOrigin, Ion,
  ImageryLayer, JulianDate, LabelCollection, LabelStyle, Material, Matrix3, Matrix4, NearFarScalar, PerInstanceColorAppearance, ColorGeometryInstanceAttribute, PointPrimitiveCollection,
  PolylineCollection, Primitive, Rectangle, ScreenSpaceEventType, SkyAtmosphere, TileMapServiceImageryProvider, Transforms, VerticalOrigin, Viewer, buildModuleUrl,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./mission/mission.css";
import type { ViewProps } from "./props";
import { bytes, hm } from "../fmt";
import { reduced } from "../anim";
import { useJson } from "../useJson";
import { Purpose } from "../ui2";
import { CAT_COLOR, DISH_ICON, DISH_ICON_LIVE, SAT_ICON, TRK, groundRangeKm } from "./mission/assets";
import { FlyTo, Ico, Switch, type Place } from "./mission/controls";

Ion.defaultAccessToken = "";

const SPEEDS = [1, 10, 60, 300]; // sim seconds per wall second
const TRAIL_MIN = 100, SEGS = 8, LEAD_MIN = 5;
const SW_DEG = 1.3; // half swath in degrees, display only (about 145 km)
const NPK = 10; // packet dots per live link
const amber = Color.fromCssColorString("#f2a93b"), teal = Color.fromCssColorString("#2dd4bf");
const css = (c: string) => Color.fromCssColorString(c);
const NAME: Record<string, string> = { blr: "Bengaluru", sone: "Sone river", hasdeo: "Hasdeo", pavagada: "Pavagada" };
const P = (lon: number, lat: number, h = 0) => Cartesian3.fromDegrees(lon, lat, h);
const D2R = Math.PI / 180;

function interp(track: ViewProps["data"]["track"], t: number): [number, number] {
  if (!track.length) return [0, 0];
  const t0 = track[0].t_min, span = track[track.length - 1].t_min - t0 || 1;
  const tt = t0 + ((t - t0) % span + span) % span;
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (track[m].t_min <= tt) lo = m; else hi = m; }
  const a = track[lo], b = track[hi], f = b.t_min === a.t_min ? 0 : (tt - a.t_min) / (b.t_min - a.t_min);
  let dl = b.lon - a.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
  return [a.lat + (b.lat - a.lat) * f, a.lon + dl * f];
}
/** compass bearing (rad, clockwise from north) of the ground track at t */
function bearing(track: ViewProps["data"]["track"], t: number): number {
  const [la, lo] = interp(track, t), [la2, lo2] = interp(track, t + 0.3);
  let dl = lo2 - lo; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
  return Math.atan2(dl * Math.cos(la * D2R), la2 - la);
}

/** 3D satellite built from Cesium primitives in unit space (+y travel, x across track, z up): bus, two solar wings, mast and dish. */
function buildSat(): Primitive {
  const vf = PerInstanceColorAppearance.FLAT_VERTEX_FORMAT;
  const box = (d: [number, number, number], at: [number, number, number], c: string) => new GeometryInstance({
    geometry: BoxGeometry.fromDimensions({ dimensions: new Cartesian3(...d), vertexFormat: vf }), modelMatrix: Matrix4.fromTranslation(new Cartesian3(...at)),
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(css(c)) } });
  const dish = new GeometryInstance({
    geometry: new EllipsoidGeometry({ radii: new Cartesian3(0.42, 0.42, 0.12), vertexFormat: vf }), modelMatrix: Matrix4.fromTranslation(new Cartesian3(0, 0.25, 0.95)),
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(css("#f4f4f5")) } });
  const wing = (s: number) => [box([3.2, 1.0, 0.07], [s * 2.35, 0, 0], "#2f5fd0"), box([3.2, 0.06, 0.09], [s * 2.35, 0, 0], "#9db8ff"), box([0.5, 0.12, 0.1], [s * 0.75, 0, 0], "#9aa4b2")];
  return new Primitive({
    geometryInstances: [box([1.0, 1.5, 1.0], [0, 0, 0], "#e6c25a"), box([1.04, 0.2, 1.04], [0, -0.55, 0], "#8a6d1c"), box([0.07, 0.07, 0.5], [0, 0.25, 0.65], "#9aa4b2"), dish, ...wing(1), ...wing(-1)],
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: false, closed: true }), asynchronous: false, allowPicking: false, show: false, modelMatrix: Matrix4.IDENTITY });
}

interface Cap { key: string; aoi: string; date: string; t: number; n: number; hi: number }
interface PassInfo { nA: number; nC: number; hiA: number; hiC: number; nO: number }
const LAYERS = [
  { id: "leads", label: "Track A: construction leads", color: TRK.A },
  { id: "solar", label: "Track A: solar sites", color: "#FACC15" },
  { id: "cases", label: "Track C: evidence cases", color: TRK.C },
  { id: "aoi", label: "AOI boxes", color: "#e7e5e4" },
  { id: "cov", label: "Station coverage", color: TRK.other },
] as const;
type LayerId = typeof LAYERS[number]["id"];

export default function Mission({ data, out, active: shown }: ViewProps & { active: boolean }) {
  const shownRef = useRef(shown); shownRef.current = shown;
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const scene = useRef<any>({});
  const wins = data.passes, splits = data.wins;
  const t0 = useMemo(() => Math.max(0, ((wins.find((w) => w.station === "bengaluru") ?? wins[0])?.start_min ?? 0) - LEAD_MIN), [wins]);
  const [t, setT] = useState(t0);
  const [play, setPlay] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [follow, setFollow] = useState(true);
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({ leads: true, solar: true, cases: true, aoi: true, cov: true });
  const [place, setPlace] = useState("Globe");
  const [callout, setCallout] = useState<Cap | null>(null);
  const tRef = useRef(t0), followRef = useRef(true), lis = useRef<HTMLUListElement>(null), calloutTimer = useRef(0);
  const siting = useJson<any>("siting.json"), evid = useJson<any>("evidence.json"), sidx = useJson<Record<string, any>>("sites_index.json");
  const epochRef = useRef<JulianDate | null>(null);
  const wj = useJson<any>("windows.json");
  useEffect(() => { if (wj?.epoch_utc) epochRef.current = JulianDate.fromIso8601(wj.epoch_utc); }, [wj]);
  followRef.current = follow;
  const tEnd = useMemo(() => data.track.length ? data.track[data.track.length - 1].t_min : 1440, [data.track]);
  const sites: any[] = data.reports.sites_blr?.sites ?? [];
  const aois = useMemo(() => {
    const m = new Map<string, [number, number, number, number]>();
    for (const x of data.tiles) { const b = m.get(x.aoi) ?? [x.lon, x.lat, x.lon, x.lat]; m.set(x.aoi, [Math.min(b[0], x.lon), Math.min(b[1], x.lat), Math.max(b[2], x.lon), Math.max(b[3], x.lat)]); }
    return m;
  }, [data.tiles]);
  // one capture per (aoi, date): the tile grid is imaged at t_cap_min
  const caps = useMemo(() => {
    const m = new Map<string, Cap>();
    for (const x of data.tiles) { const k = `${x.aoi}|${x.date}`, c = m.get(k) ?? { key: k, aoi: x.aoi, date: x.date, t: x.t_cap_min, n: 0, hi: 0 }; c.n++; if (x.sev >= 0.1) c.hi++; m.set(k, c); }
    return [...m.values()].sort((a, b) => a.t - b.t);
  }, [data.tiles]);
  const capsRef = useRef(caps); capsRef.current = caps;
  const ready = siting !== undefined && evid !== undefined && !!wj;
  const range = useMemo(() => groundRangeKm(data.reports.sim?.physics?.mean_alt_km ?? 786, wj?.min_el ?? 10), [data.reports.sim, wj]);

  useEffect(() => {
    if (!ready) return;
    const v = new Viewer(box.current!, {
      baseLayer: ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"))),
      geocoder: false, baseLayerPicker: false, animation: false, timeline: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true,
      maximumRenderTimeChange: Infinity, shouldAnimate: false, skyBox: false, skyAtmosphere: false, creditContainer: document.createElement("div"),
    });
    v.useBrowserRecommendedResolution = false; v.resolutionScale = Math.min(window.devicePixelRatio || 1, 2); v.scene.postProcessStages.fxaa.enabled = true;
    v.scene.globe.enableLighting = true; v.scene.globe.showWaterEffect = false; v.scene.globe.showGroundAtmosphere = true;
    const sky = new SkyAtmosphere(); sky.brightnessShift = -0.25; v.scene.skyAtmosphere = sky;
    const stars = v.scene.primitives.add(new PointPrimitiveCollection());
    for (let i = 0; i < 700; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, r = Math.sqrt(1 - u * u); stars.add({ position: new Cartesian3(r * Math.cos(a) * 3e8, r * Math.sin(a) * 3e8, u * 3e8), pixelSize: 1 + Math.random() * 1.2, color: Color.WHITE.withAlpha(0.25 + Math.random() * 0.6) }); }
    v.scene.backgroundColor = css("#0f0d0c");
    v.scene.globe.baseColor = css("#1c1917");
    v.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    // AOI boxes
    const aoiEnt: any[] = [];
    [...aois].sort((a, b) => b[1][1] - a[1][1]).forEach(([id, b], k) => {
      const up = k % 2 === 0;
      aoiEnt.push(v.entities.add({ id: `aoi-${id}`, rectangle: { coordinates: Rectangle.fromDegrees(b[0], b[1], b[2], b[3]), material: Color.TRANSPARENT, outline: true, outlineColor: Color.WHITE.withAlpha(0.8), height: 0 },
        position: P((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), point: { pixelSize: 5, color: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 1 },
        label: { text: NAME[id] ?? id, font: "600 13px 'Source Sans 3', system-ui, sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: up ? HorizontalOrigin.LEFT : HorizontalOrigin.RIGHT, verticalOrigin: up ? VerticalOrigin.BOTTOM : VerticalOrigin.TOP, pixelOffset: new Cartesian2(up ? 9 : -9, up ? -8 : 8) } }));
    });
    // station coverage: translucent ground ellipse of radius `range` (elevation >= min_el)
    const covEnt = new Map<string, any>();
    for (const s of data.stations) covEnt.set(s.id, v.entities.add({ position: P(s.lon, s.lat), ellipse: { semiMajorAxis: range * 1000, semiMinorAxis: range * 1000, material: teal.withAlpha(0.13), outline: true, outlineColor: teal.withAlpha(0.6), height: 0 } }));
    // stations: dish icon + name
    const dishes = v.scene.primitives.add(new BillboardCollection()), names = v.scene.primitives.add(new LabelCollection());
    const stB = new Map<string, any>();
    for (const s of data.stations) {
      stB.set(s.id, dishes.add({ position: P(s.lon, s.lat, 2000), image: DISH_ICON, width: 30, height: 30, verticalOrigin: VerticalOrigin.BOTTOM, disableDepthTestDistance: 2e6 }));
      names.add({ position: P(s.lon, s.lat, 2000), text: s.name, font: "600 12px 'Source Sans 3', system-ui, sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, 6), verticalOrigin: VerticalOrigin.TOP, horizontalOrigin: HorizontalOrigin.CENTER, disableDepthTestDistance: 2e6, distanceDisplayCondition: new DistanceDisplayCondition(0, 3.2e7) });
    }
    // layer markers
    const leadsC = v.scene.primitives.add(new PointPrimitiveCollection());
    for (const s of sites) leadsC.add({ position: P(s.lon, s.lat, 300), pixelSize: 3 + Math.min(4, Math.sqrt(s.ha ?? 1) / 2), color: css(CAT_COLOR[s.category] ?? "#FF8A3D").withAlpha(0.9), outlineColor: Color.BLACK.withAlpha(0.5), outlineWidth: 1 });
    const solarC = v.scene.primitives.add(new PointPrimitiveCollection()), solarL = v.scene.primitives.add(new LabelCollection());
    for (const s of (siting?.top_solar ?? []).slice(0, 10)) {
      solarC.add({ position: P(s.lon, s.lat, 300), pixelSize: 9, color: css("#FACC15"), outlineColor: Color.BLACK, outlineWidth: 2 });
      solarL.add({ position: P(s.lon, s.lat, 300), text: String(s.rank), font: "700 12px 'Fira Code', monospace", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(8, -8), distanceDisplayCondition: new DistanceDisplayCondition(0, 9e5) });
    }
    const casesC = v.scene.primitives.add(new PointPrimitiveCollection());
    for (const c of evid?.cards ?? []) casesC.add({ position: P(c.lon, c.lat, 300), pixelSize: 8, color: css(TRK.C), outlineColor: Color.WHITE, outlineWidth: 1.5 });
    // dynamic parts
    const pts = v.scene.primitives.add(new PointPrimitiveCollection());
    const packets = Array.from({ length: 3 * NPK }, () => pts.add({ position: P(0, 0), pixelSize: 4, color: teal, show: false }));
    const foot = v.entities.add({ position: P(0, 0), ellipse: { semiMajorAxis: SW_DEG * 111000, semiMinorAxis: SW_DEG * 111000, material: amber.withAlpha(0.14), outline: true, outlineColor: amber.withAlpha(0.5), height: 0 } });
    const flash = v.entities.add({ show: false, rectangle: { coordinates: Rectangle.fromDegrees(0, 0, 1, 1), material: Color.WHITE.withAlpha(0.4), outline: true, outlineColor: Color.WHITE, height: 0 } });
    const crop = v.entities.add({ show: false, position: P(0, 0), billboard: { image: "/data/img/sites/blr_site2050_t1.jpg", width: 132, height: 132, pixelOffset: new Cartesian2(84, -84), disableDepthTestDistance: Infinity },
      point: { pixelSize: 12, color: Color.TRANSPARENT, outlineColor: css(TRK.A), outlineWidth: 3, disableDepthTestDistance: Infinity } });
    const sats = v.scene.primitives.add(new BillboardCollection());
    const halo = pts.add({ position: P(0, 0, 786000), pixelSize: 44, color: amber.withAlpha(0.12) });
    const satB = sats.add({ position: P(0, 0, 786000), image: SAT_ICON, width: 46, height: 46, disableDepthTestDistance: Infinity, scaleByDistance: new NearFarScalar(2e6, 1.15, 4e7, 0.85) });
    const sat3 = v.scene.primitives.add(buildSat());
    const lines = v.scene.primitives.add(new PolylineCollection());
    const mat = (c: Color) => Material.fromType("Color", { color: c });
    const trail = Array.from({ length: SEGS }, (_, j) => lines.add({ positions: [P(0, 0), P(1, 1)], width: 2.4, material: mat(amber.withAlpha(0.8 * Math.pow(1 - j / SEGS, 1.2) + 0.15)), show: false }));
    const swath = lines.add({ positions: [P(0, 0), P(1, 1)], width: 4, material: mat(amber), show: false });
    const nadir = lines.add({ positions: [P(0, 0), P(1, 1)], width: 1, material: mat(Color.WHITE.withAlpha(0.35)), show: false });
    const dash = () => Material.fromType("PolylineDash", { color: teal.withAlpha(0.8), gapColor: Color.TRANSPARENT, dashLength: 14, dashPattern: 255 });
    const arcs = Array.from({ length: 3 }, () => lines.add({ positions: [P(0, 0), P(1, 1)], width: 2, material: dash(), show: false }));
    const [lon0, lat0] = interp(data.track, t0);
    const rd = { ok: false, intro: false, flown: false };
    v.camera.setView({ destination: P(lon0, lat0 * 0.8, reduced() ? 1.6e7 : 4.5e7) });
    if (reduced()) rd.intro = true;
    v.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
      if (n !== 0) return; rd.ok = true;
      if (!rd.flown && !reduced()) { rd.flown = true; v.camera.flyTo({ destination: P(lon0, lat0 * 0.8, 1.6e7), duration: 3, easingFunction: EasingFunction.CUBIC_IN_OUT, complete: () => { rd.intro = true; } }); }
    });
    scene.current = { rd, satB, sat3, halo, foot, flash, crop, packets, stB, covEnt, aoiEnt, trail, swath, nadir, arcs, leadsC, solarC, solarL, casesC, flashAt: 0, covKey: "", pk: new Array(3 * NPK).fill("") };
    viewer.current = v;
    const off = () => { followRef.current = false; setFollow(false); };
    const el = v.canvas; el.addEventListener("pointerdown", off);
    return () => { el.removeEventListener("pointerdown", off); v.useDefaultRenderLoop = false; v.camera.cancelFlight(); v.destroy(); viewer.current = null; scene.current = {}; };
  }, [ready, data.track, data.stations, aois, t0, sites, siting, evid, range]);

  // layer toggles
  useEffect(() => {
    const S = scene.current, v = viewer.current; if (!S.leadsC || !v) return;
    S.leadsC.show = layers.leads; S.solarC.show = layers.solar; S.solarL.show = layers.solar; S.casesC.show = layers.cases;
    S.aoiEnt.forEach((e: any) => { e.show = layers.aoi; }); S.covEnt.forEach((e: any) => { e.show = layers.cov; });
    v.scene.requestRender();
  }, [layers, ready]);

  const bytesRef = useRef<{ b: number[]; max: number }>({ b: [], max: 1 });
  useEffect(() => { const v = viewer.current; if (v && !v.isDestroyed()) { v.useDefaultRenderLoop = shown; if (shown) v.scene.requestRender(); } }, [shown]);
  const wRef = useRef(wins); wRef.current = wins;
  const stRef = useRef(data.stations); stRef.current = data.stations;

  // passes: which track's data the H2 plan sends in each contact
  const tl = out?.results.H2.timeline;
  const perPass = useMemo(() => wins.map((p) => {
    let b = 0, c = 0; const info: PassInfo = { nA: 0, nC: 0, hiA: 0, hiC: 0, nO: 0 };
    if (tl && out) {
      const idx = new Set<number>();
      splits.forEach((s, i) => { if (s.station === p.station && s.start_min >= p.start_min - 1e-3 && s.end_min <= p.end_min + 1e-3) { idx.add(i); b += tl.bytes[i]; c += tl.cap[i]; } });
      for (const [ti, , wi] of out.results.H2.sel) if (idx.has(wi)) { const x = data.tiles[ti]; if (x.aoi === "blr") { info.nA++; if (x.sev >= 0.1) info.hiA++; } else { info.nC++; if (x.sev >= 0.1) info.hiC++; } }
    }
    return { bytes: b, cap: c, info };
  }), [wins, splits, tl, out, data.tiles]);
  bytesRef.current = { b: perPass.map((x) => x.bytes), max: Math.max(1, ...perPass.map((x) => x.bytes)) };
  const infoRef = useRef(perPass); infoRef.current = perPass;

  useEffect(() => {
    let raf = 0, last = performance.now(), ui = 0, tr = 0, prevT = tRef.current, lastUi = -1;
    const [la0, lo0] = interp(data.track, tRef.current); let cl = lo0, cb = la0 * 0.8;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const S = scene.current, v = viewer.current;
      if (!S.satB || !v || !shownRef.current) return;
      if (play) tRef.current = (tRef.current + (dt * SPEEDS[speed]) / 60) % tEnd;
      const tt = tRef.current;
      // capture event: the clock just crossed a capture time -> flash the footprint + callout
      if (tt > prevT && tt - prevT < 40) for (const c of capsRef.current) if (c.t > prevT && c.t <= tt) {
        const b = aois.get(c.aoi); if (!b) continue;
        S.flash.rectangle.coordinates = Rectangle.fromDegrees(b[0], b[1], b[2], b[3]); S.flash.show = true; S.flashAt = now;
        setCallout(c); window.clearTimeout(calloutTimer.current); calloutTimer.current = window.setTimeout(() => setCallout(null), 7000);
      }
      prevT = tt;
      const [lat, lon] = interp(data.track, tt);
      const sp = P(lon, lat, 786000);
      const hd = bearing(data.track, tt);
      const dist = Cartesian3.distance(v.camera.positionWC, sp), near = dist < 6e6;
      S.satB.position = sp; S.satB.rotation = -hd; S.satB.show = !near; S.halo.position = sp; S.halo.show = !near;
      S.sat3.show = near;
      if (near) {
        const s = dist * 0.03, m = Transforms.eastNorthUpToFixedFrame(sp);
        Matrix4.multiplyByMatrix3(m, Matrix3.fromRotationZ(-hd), m); Matrix4.multiplyByUniformScale(m, s, m); S.sat3.modelMatrix = m;
      }
      if (epochRef.current) v.clock.currentTime = JulianDate.addSeconds(epochRef.current, tt * 60, new JulianDate());
      if (S.flash.show) {
        const k = (now - S.flashAt) / 2600;
        if (k >= 1) S.flash.show = false; else S.flash.rectangle.material = Color.WHITE.withAlpha(0.45 * (1 - k) * (0.6 + 0.4 * Math.sin(k * 30)));
      }
      if (now - tr > 90 || !play) {
        tr = now;
        for (let j = 0; j < SEGS; j++) {
          const a = tt - (j * TRAIL_MIN) / SEGS, pos: Cartesian3[] = [];
          for (let k = 0; k <= 5; k++) { const [la, lo] = interp(data.track, a - (k * TRAIL_MIN) / SEGS / 5); pos.push(P(lo, la, 4000)); }
          S.trail[j].positions = pos; S.trail[j].show = true;
        }
        const [la2, lo2] = interp(data.track, tt + 0.3);
        const c = Math.max(0.1, Math.cos(lat * D2R));
        let dx = (lo2 - lon) * c, dy = la2 - lat; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
        S.swath.positions = [P(lon + (dy * SW_DEG) / c, lat - dx * SW_DEG, 4000), P(lon - (dy * SW_DEG) / c, lat + dx * SW_DEG, 4000)]; S.swath.show = true;
        S.nadir.positions = [sp, P(lon, lat, 0)]; S.nadir.show = true;
        S.foot.position = new ConstantPositionProperty(P(lon, lat));
      }
      const act = wRef.current.filter((w) => tt >= w.start_min && tt < w.end_min);
      const ph = 0.5 + 0.5 * Math.sin(now / 260);
      const on = new Set(act.map((w) => w.station));
      for (const [id, b] of S.stB as Map<string, any>) {
        const live = on.has(id);
        b.scale = live && !reduced() ? 1.15 + 0.2 * ph : live ? 1.25 : 1; b.image = live ? DISH_ICON_LIVE : DISH_ICON;
      }
      const key = [...on].sort().join(",");
      if (key !== S.covKey) {
        S.covKey = key;
        for (const [id, e] of S.covEnt as Map<string, any>) { const l = on.has(id); e.ellipse.material = teal.withAlpha(l ? 0.28 : 0.13); e.ellipse.outlineColor = teal.withAlpha(l ? 0.95 : 0.6); }
      }
      S.arcs.forEach((a: any, i: number) => {
        const w = act[i], st = w && stRef.current.find((s) => s.id === w.station);
        a.show = !!st; if (st) a.positions = [sp, P(st.lon, st.lat, 0)];
        const wi = w ? wRef.current.indexOf(w) : -1;
        const bw = wi >= 0 ? bytesRef.current.b[wi] ?? 0 : 0, rate = 0.25 + 1.4 * (bw / bytesRef.current.max);
        const inf = wi >= 0 ? infoRef.current[wi]?.info : null, tot = inf ? inf.nA + inf.nC : 0, nA = tot ? Math.round((inf!.nA / tot) * NPK) : 0, nC = tot ? NPK - nA : 0;
        for (let k = 0; k < NPK; k++) {
          const pk = S.packets[i * NPK + k]; pk.show = !!st;
          const col = !tot ? TRK.other : k < nA ? TRK.A : k < nA + nC ? TRK.C : TRK.other;
          if (S.pk[i * NPK + k] !== col) { S.pk[i * NPK + k] = col; pk.color = css(col); }
          if (st) pk.position = Cartesian3.lerp(sp, P(st.lon, st.lat, 0), (((now / 1000) * rate + k / NPK) % 1 + 1) % 1, new Cartesian3());
        }
      });
      if (followRef.current && S.rd.intro) {
        const dl = ((lon - cl + 540) % 360) - 180;
        cl = (cl + dl * Math.min(1, dt * 3) + 540) % 360 - 180; cb += (Math.max(-55, Math.min(55, lat * 0.8)) - cb) * Math.min(1, dt * 3);
        v.camera.setView({ destination: P(cl, cb, 1.6e7) });
      } else { cl = lon; cb = lat * 0.8; }
      if (play || (followRef.current && S.rd.intro) || on.size || S.flash.show) v.scene.requestRender();
      if (now - ui > 100 && tt !== lastUi) { ui = now; lastUi = tt; setT(tt); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [play, speed, tEnd, data.track, aois, ready, range, sites, siting, evid]);

  const fly = useCallback((name: string, d0?: number) => {
    const v = viewer.current; if (!v) return; setFollow(false); followRef.current = false; v.camera.cancelFlight();
    const d = reduced() ? 0 : d0 ?? 1.8, easingFunction = EasingFunction.CUBIC_IN_OUT;
    if (name === "Globe") { const [la, lo] = interp(data.track, tRef.current); return v.camera.flyTo({ destination: P(lo, la * 0.8, 3.2e7), duration: d, easingFunction }); }
    if (name === "India") return v.camera.flyTo({ destination: Rectangle.fromDegrees(64, 4, 100, 38), duration: d, easingFunction });
    const b = name === "pavagada" ? (siting?.bbox as number[] | undefined) : aois.get(name);
    if (!b) return;
    const pad = 0.12; v.camera.flyTo({ destination: Rectangle.fromDegrees(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad), duration: d, easingFunction });
  }, [aois, siting, data.track]);
  const onPlace = (id: string) => { setPlace(id); fly(id); };
  const places: Place[] = useMemo(() => [
    { id: "blr", name: "Bengaluru", sub: "Track A: construction", ico: "city" },
    { id: "pavagada", name: "Pavagada", sub: "Track A: solar siting", ico: "sun" },
    { id: "hasdeo", name: "Hasdeo", sub: "Track C: forest and mines", ico: "tree" },
    { id: "sone", name: "Sone river", sub: "Track C: sand mining", ico: "wave" },
    { id: "India", name: "India", sub: "All four areas at once", ico: "map" },
    { id: "Globe", name: "Globe", sub: "Whole orbit", ico: "globe" },
  ].filter((p) => (p.id === "India" || p.id === "Globe" ? true : p.id === "pavagada" ? !!siting?.bbox : aois.has(p.id))) as Place[], [aois, siting]);

  const active = wins.find((w) => t >= w.start_min && t < w.end_min);
  const next = wins.filter((w) => w.start_min > t).sort((a, b) => a.start_min - b.start_min)[0];
  const stName = useMemo(() => new Map(data.stations.map((s) => [s.id, s.name])), [data.stations]);
  const cd = active ? active.end_min - t : next ? next.start_min - t : null;
  const rel = t - t0;
  const activeIdx = active ? wins.indexOf(active) : -1, inf = activeIdx >= 0 ? perPass[activeIdx]?.info : null;
  useEffect(() => {
    const ul = lis.current, li = ul?.querySelector<HTMLElement>("li.live, li.nxt"); if (!ul || !li) return;
    ul.scrollTo({ top: li.offsetTop - ul.clientHeight / 3, behavior: reduced() ? "auto" : "smooth" });
  }, [active, next]);

  // ---------- story tour ----------
  const [tour, setTour] = useState<number | null>(null);
  const site = sidx?.blr_site2050, card = useMemo(() => (evid?.cards ?? []).filter((c: any) => c.aoi === "hasdeo" && c.kind === "mine_expansion").sort((a: any, b: any) => b.ha - a.ha)[0], [evid]);
  const hp = data.reports.sim?.headline_rho5, blrT1 = caps.find((c) => c.key === "blr|t1"), hasT1 = caps.find((c) => c.key === "hasdeo|t1");
  const blrPass = wins.find((w) => w.station === "bengaluru" && blrT1 && w.end_min > blrT1.t);
  const f1 = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  const STEPS = useMemo(() => [
    { t: "Capture", cap: `Satellite images Bengaluru: ${blrT1?.n.toLocaleString("en-IN") ?? "2,116"} tiles in one pass.` },
    { t: "Onboard AI", cap: `The onboard AI flags a ${site ? f1(site.ha) : "51"} ha new layout.` },
    { t: "Downlink", cap: hp ? `Bengaluru station gets the first insight in ${f1(hp.ttfi_min.H2)} min; FIFO takes ${Math.round(hp.ttfi_min.B1).toLocaleString("en-IN")}.` : "Bengaluru station gets the flagged tile first." },
    { t: "Work queue", cap: "A city officer opens it in the lead ledger.", link: ["#/ledger?open=blr_site2050", "Open this lead"] },
    { t: "Evidence", cap: `Hasdeo: ${card ? f1(card.ha) : "15"} ha mine expansion becomes a sealed evidence card.`, link: [`#/evidence?open=${card?.card_id ?? ""}`, "Open this case"] },
  ] as { t: string; cap: string; link?: [string, string] }[], [blrT1, site, hp, card]);
  useEffect(() => {
    if (tour == null) return;
    const S = scene.current, v = viewer.current; if (!v || !S.crop) return;
    setFollow(false); followRef.current = false;
    const jump = (m: number, pl: boolean, sp = 2) => { tRef.current = m; setT(m); setPlay(pl); setSpeed(sp); };
    S.crop.show = tour === 1 || tour === 3;
    if (site) S.crop.position = new ConstantPositionProperty(P(site.lon, site.lat, 100));
    if (tour === 0 && blrT1) { jump(blrT1.t - 4, true, 2); v.camera.cancelFlight(); const b = aois.get("blr"); if (b) v.camera.flyTo({ destination: Rectangle.fromDegrees(b[0] - 2.2, b[1] - 2.2, b[2] + 2.2, b[3] + 2.2), duration: reduced() ? 0 : 2.2 }); }
    if (tour === 1 && blrT1) { jump(blrT1.t + 0.4, false); if (site) v.camera.flyTo({ destination: Rectangle.fromDegrees(site.bbox[0] - 0.04, site.bbox[1] - 0.04, site.bbox[2] + 0.04, site.bbox[3] + 0.04), duration: reduced() ? 0 : 2 }); }
    if (tour === 2) { if (blrPass) jump(blrPass.start_min - 1, true, 2); v.camera.cancelFlight(); v.camera.flyTo({ destination: Rectangle.fromDegrees(68, 3, 90, 26), duration: reduced() ? 0 : 2 }); }
    if (tour === 3) { setPlay(false); v.camera.cancelFlight(); if (site) v.camera.flyTo({ destination: Rectangle.fromDegrees(site.bbox[0] - 0.05, site.bbox[1] - 0.05, site.bbox[2] + 0.05, site.bbox[3] + 0.05), duration: reduced() ? 0 : 1.5 }); }
    if (tour === 4 && hasT1) { jump(hasT1.t - 4, true, 2); const b = aois.get("hasdeo"); v.camera.cancelFlight(); if (b) v.camera.flyTo({ destination: Rectangle.fromDegrees(b[0] - 2.2, b[1] - 2.2, b[2] + 2.2, b[3] + 2.2), duration: reduced() ? 0 : 2.2 }); }
    v.scene.requestRender();
  }, [tour]); // eslint-disable-line
  const exitTour = () => { setTour(null); if (scene.current.crop) scene.current.crop.show = false; setPlay(false); };
  useEffect(() => {
    if (tour == null) return;
    const k = (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      if (e.key === "ArrowRight") setTour((n) => Math.min(STEPS.length - 1, (n ?? 0) + 1)); else if (e.key === "ArrowLeft") setTour((n) => Math.max(0, (n ?? 0) - 1)); else if (e.key === "Escape") exitTour();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [tour, STEPS.length]); // eslint-disable-line
  const scrub = (m: number) => { tRef.current = m; setT(m); viewer.current?.scene.requestRender(); };
  const dayN = Math.floor(Math.max(0, rel) / 1440) + 1, days = Math.ceil((tEnd - t0) / 1440);
  const tracks = [!!inf && inf.nA > 0 && { c: TRK.A, l: "Track A", n: inf.hiA, w: "leads" }, !!inf && inf.nC > 0 && { c: TRK.C, l: "Track C", n: inf.hiC, w: "cases" }].filter(Boolean) as { c: string; l: string; n: number; w: string }[];

  return (
    <div className="missionwrap">
      <Purpose who="Mission planner, ground-segment lead" does="Watch one 5-day orbit, scrub time, switch layers on the globe"
        decision="Is the downlink spent on the right data?"
        result={hp ? <><b className="mono">{f1(hp.ratio_vs_fifo.H2)}x</b> more value than FIFO; first insight in <b className="mono">{f1(hp.ttfi_min.H2)} min</b> vs <b className="mono">{Math.round(hp.ttfi_min.B1).toLocaleString("en-IN")}</b></> : "n/a"} />
      <div className="mission">
        <div className="globe" aria-label="Globe with satellite, recent ground track, stations, coverage and AOI boxes">
          <div className="gl" ref={box} />
          <div className={`hud ${active ? "live" : ""}`} aria-live="polite">
            {active ? <><i className="dot" />CONTACT <b>{stName.get(active.station) ?? active.station}</b></> : next ? <>NEXT <b>{stName.get(next.station) ?? next.station}</b></> : "no further passes"}
          </div>
          {callout && <div className="callout" role="status"><i style={{ background: TRK.A }} />Captured <b>{NAME[callout.aoi] ?? callout.aoi}</b>: <span className="mono">{callout.n.toLocaleString("en-IN")}</span> tiles, <span className="mono">{callout.hi}</span> high-value<small>{callout.date.toUpperCase()}</small></div>}
          {tour == null && <button className="tourbtn primary" onClick={() => setTour(0)}><Ico n="route" />Take the tour</button>}
          {tour != null && (
            <section className="tour" role="dialog" aria-label={`Story tour, step ${tour + 1} of ${STEPS.length}`}>
              <div className="tstep"><span className="mono">{tour + 1}/{STEPS.length}</span><b>{STEPS[tour].t}</b>
                <span className="dots" aria-hidden="true">{STEPS.map((_, i) => <i key={i} className={i === tour ? "on" : i < tour ? "done" : ""} />)}</span></div>
              <p aria-live="polite">{STEPS[tour].cap}</p>
              {tour === 1 && site && <img className="crop" src="/data/img/sites/blr_site2050_t1.jpg" width={96} height={96} alt={`Native 10 m crop of site 2050 (${f1(site.ha)} ha)`} />}
              <div className="tact">
                <button onClick={() => setTour(Math.max(0, tour - 1))} disabled={tour === 0}>Back</button>
                {tour < STEPS.length - 1 ? <button className="primary" onClick={() => setTour(tour + 1)}>Next</button> : <button className="primary" onClick={exitTour}>Finish</button>}
                {STEPS[tour].link && <a className="tlink" href={STEPS[tour].link![0]}>{STEPS[tour].link![1]}</a>}
                <button className="lnk" onClick={exitTour}>Exit</button>
              </div>
            </section>)}
        </div>
        <aside className="mpanel" aria-label="Mission controls">
          <section className="mcard clock">
            <header><h3>Mission clock</h3><span className="dim small">Day {Math.min(dayN, days)} of {days}</span></header>
            <div className="big mono" aria-live="off">T+{hm(Math.max(0, rel))}</div>
            <div className="ctl">
              <button className="icon primary" onClick={() => setPlay(!play)} aria-label={play ? "Pause" : "Play"}><Ico n={play ? "pause" : "play"} /></button>
              <button className="icon" onClick={() => scrub(t0)} aria-label="Restart"><Ico n="restart" /></button>
              <div className="segm" role="group" aria-label="Simulation speed">{SPEEDS.map((s, i) => <button key={s} className={speed === i ? "on" : ""} onClick={() => setSpeed(i)} aria-pressed={speed === i}>{s}x</button>)}</div>
            </div>
            <div className="scrub">
              <div className="ticks" aria-hidden="true">
                {wins.map((w, i) => <i key={i} className={`${w === active ? "live" : ""}`} style={{ left: `${(w.start_min / tEnd) * 100}%` }} />)}
                {caps.map((c) => <b key={c.key} title={`${NAME[c.aoi] ?? c.aoi} ${c.date}`} style={{ left: `${(c.t / tEnd) * 100}%` }} />)}
              </div>
              <input type="range" min={0} max={tEnd} step={1} value={Math.round(t)} onChange={(e) => scrub(+e.target.value)} aria-label="Scrub mission time" aria-valuetext={`T+${hm(Math.max(0, rel))}`} />
            </div>
            <div className="legend2"><span><i className="tk" />contact pass</span><span><i className="tk cap" />capture</span></div>
            <div className="countdown">
              {active ? <>Contact <b>{stName.get(active.station) ?? active.station}</b> closes in <b className="mono">{(cd! * 60).toFixed(0)} s</b></>
                : next ? <>Next pass <b>{stName.get(next.station) ?? next.station}</b> in <b className="mono">{Math.floor(cd!)}m {String(Math.floor((cd! % 1) * 60)).padStart(2, "0")}s</b></> : "no further passes"}
            </div>
            <div className="nowsend" aria-live="polite">
              {active && tracks.length ? <><span className="dim">now sending</span>{tracks.map((x) => <span key={x.l} className="ns"><i style={{ background: x.c }} /><b className="mono">{x.n}</b> {x.l} {x.w}</span>)}</> : <span className="dim">{active ? "now sending: filler tiles only" : "now sending: nothing (no contact)"}</span>}
            </div>
          </section>
          <section className="mcard">
            <header><h3>Camera</h3></header>
            <FlyTo places={places} value={place} onPick={onPlace} />
            <Switch checked={follow} onChange={(on) => { setFollow(on); if (on) { followRef.current = true; } }} label="Follow satellite" />
          </section>
          <section className="mcard">
            <header><h3>Layers</h3><span className="dim small">how tracks A, B, C connect</span></header>
            <ul className="layers">
              {LAYERS.map((l) => {
                const n = l.id === "leads" ? sites.length : l.id === "solar" ? Math.min(10, siting?.top_solar?.length ?? 0) : l.id === "cases" ? evid?.cards?.length ?? 0 : l.id === "aoi" ? aois.size : data.stations.length;
                return <li key={l.id}><label><input type="checkbox" checked={layers[l.id]} onChange={(e) => setLayers({ ...layers, [l.id]: e.target.checked })} /><i style={{ background: l.color }} /><span>{l.label}</span><b className="mono">{n}</b></label></li>;
              })}
            </ul>
            <div className="legend2 wrapl"><span><i style={{ background: TRK.A }} />Track A packets</span><span><i style={{ background: TRK.C }} />Track C packets</span><span><i style={{ background: TRK.other }} />other tiles</span></div>
            <p className="dim small cov">Coverage rings: {Math.round(range).toLocaleString("en-IN")} km ground range at {wj?.min_el ?? 10}° elevation.</p>
          </section>
          <section className="mcard grow">
            <header><h3>Contact windows</h3><span className="dim small">{wins.length} passes</span></header>
            <ul className="wins" tabIndex={0} aria-label="contact windows" ref={lis}>
              {wins.map((w, wi) => {
                const r = tl ? perPass[wi] : null;
                return (
                  <li key={wi} className={active === w ? "live" : w.end_min < t ? "past" : w === next ? "nxt" : ""}>
                    <span className="mono">{hm(w.start_min)}</span><span className="trunc">{stName.get(w.station) ?? w.station}</span>
                    <span className="mono r">{(w.end_min - w.start_min).toFixed(1)} min</span>
                    <span className="mono r dim">{r ? `${bytes(active === w ? r.bytes * Math.min(1, (t - w.start_min) / (w.end_min - w.start_min)) : r.bytes)} / ${bytes(r.cap)}` : "-"}</span>
                  </li>);
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
