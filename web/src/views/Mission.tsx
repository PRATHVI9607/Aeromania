import { useEffect, useMemo, useRef, useState } from "react";
import {
  BillboardCollection, Cartesian2, Cartesian3, Color, HeadingPitchRange, LabelCollection, Matrix4, NearFarScalar, ConstantPositionProperty, EasingFunction, HorizontalOrigin, JulianDate, LabelStyle, Material, PointPrimitiveCollection, PolylineCollection,
  Rectangle, VerticalOrigin, Viewer, ScreenSpaceEventType,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { ViewProps } from "./props";
import { bytes, hm, inr } from "../fmt";
import { reduced } from "../anim";
import { useJson } from "../useJson";
import { makeEarth } from "../cz";
import { createSatellite, DISH_ICON } from "./satModel";
import { buildInsights, type Insight } from "./insights";
import "./command.css";


const SPEEDS = [1, 10, 60, 300, 1200]; // sim seconds per wall second
const TRAIL_MIN = 100, SEGS = 8, LEAD_MIN = 5; // display only: about one orbit of trail, fading in 8 steps; clock starts 5 min before first contact
const SW_DEG = 1.3; // half swath in degrees, display only (about 145 km)
const amber = Color.fromCssColorString("#f2a93b"), teal = Color.fromCssColorString("#6fd3c0");
const PRESET_NAMES: Record<string, string> = { blr: "Bengaluru A", sone: "Sone C", hasdeo: "Hasdeo C", pavagada: "Pavagada A" };
const LAYERS = [["leads", "Construction leads", "A"], ["solar", "Solar sites", "A"], ["evidence", "Evidence cases", "C"], ["aoi", "AOI boxes", ""], ["coverage", "Station coverage", "B"]] as const;
const TOUR = [
  ["A satellite at 786 km photographs India; the ground sees it for minutes.", "Satellite"],
  ["Six ground stations. Each downlink window is a scarce contact cap.", "Globe"],
  ["Track A: new construction near Bengaluru, found in the scene.", "blr"],
  ["Track C: forest clearing evidence at Hasdeo, land cover only.", "hasdeo"],
  ["HERALD sends these first; FIFO is still sending cloud and empty tiles.", "India"],
] as const;
const ORBIT_KM = 786, EL_MIN = 10; // 10 degree minimum elevation
const RE = 6371;
/** ground range (m) of the contact cap: central angle = acos(Re/(Re+h) cos el) - el */
export const capRangeM = (h = ORBIT_KM, el = EL_MIN) => { const e = (el * Math.PI) / 180; return (Math.acos((RE / (RE + h)) * Math.cos(e)) - e) * RE * 1000; };
const NPK = 10; // packet dots per live link
const P = (lon: number, lat: number, h = 0) => Cartesian3.fromDegrees(lon, lat, h);

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

export default function Mission({ data, out, active: shown }: ViewProps & { active: boolean }) {
  const shownRef = useRef(shown); shownRef.current = shown;
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const scene = useRef<any>({});
  const wins = data.passes, splits = data.wins; // passes = real contact windows; splits = scheduler windows (indices of the H2 timeline)
  // demo opens over India: LEAD_MIN before the first Bengaluru pass (it contains the first capture), else the first pass
  const t0 = useMemo(() => { // clock opens LEAD_MIN before the first Bengaluru capture (fallback: first Bengaluru pass), so capture and downlink play out on the first view
    const caps = data.tiles.filter((x) => x.aoi === "blr").map((x) => x.t_cap_min);
    return Math.max(0, (caps.length ? Math.min(...caps) : (wins.find((w) => w.station === "bengaluru") ?? wins[0])?.start_min ?? 0) - LEAD_MIN);
  }, [wins, data.tiles]);
  const [t, setT] = useState(t0);
  const [play, setPlay] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [layers, setLayers] = useState<Record<string, boolean>>({ leads: true, solar: true, evidence: true, aoi: true, coverage: true });
  const [tab, setTab] = useState<"feed" | "wins">("feed");
  const [tour, setTour] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const closeRef = useRef(false), tRef = useRef(t0), followRef = useRef(true), lis = useRef<HTMLUListElement>(null);
  const wj = useJson<any>("windows.json"), siting = useJson<any>("siting.json");
  const epochRef = useRef<JulianDate | null>(null);
  useEffect(() => { if (wj?.epoch_utc) epochRef.current = JulianDate.fromIso8601(wj.epoch_utc); }, [wj]);
  followRef.current = follow;
  const tEnd = useMemo(() => data.track.length ? data.track[data.track.length - 1].t_min : 1440, [data.track]);
  const aois = useMemo(() => {
    const m = new Map<string, [number, number, number, number]>();
    for (const x of data.tiles) {
      const b = m.get(x.aoi) ?? [x.lon, x.lat, x.lon, x.lat];
      m.set(x.aoi, [Math.min(b[0], x.lon), Math.min(b[1], x.lat), Math.max(b[2], x.lon), Math.max(b[3], x.lat)]);
    }
    return m;
  }, [data.tiles]);

  useEffect(() => {
    const v = makeEarth(box.current!);
    v.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    // AOI boxes + points; labels alternate side (sorted north to south) so sone/hasdeo and blr/pavagada never overlap
    const sorted = [...aois].sort((a, b) => b[1][1] - a[1][1]);
    sorted.forEach(([id, b], k) => {
      const up = k % 2 === 0;
      v.entities.add({ id, rectangle: { coordinates: Rectangle.fromDegrees(b[0], b[1], b[2], b[3]), material: Color.TRANSPARENT, outline: true, outlineColor: Color.WHITE.withAlpha(0.8), height: 0 },
        position: P((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), point: { pixelSize: 5, color: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 1 },
        label: { text: id, font: "12px ui-monospace, monospace", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: up ? HorizontalOrigin.LEFT : HorizontalOrigin.RIGHT, verticalOrigin: up ? VerticalOrigin.BOTTOM : VerticalOrigin.TOP,
          pixelOffset: new Cartesian2(up ? 9 : -9, up ? -8 : 8) } });
    });
    const pts = v.scene.primitives.add(new PointPrimitiveCollection());
    const stPts = new Map<string, any>();
    for (const s of data.stations) stPts.set(s.id, pts.add({ position: P(s.lon, s.lat), pixelSize: 8, color: teal, outlineColor: teal.withAlpha(0), outlineWidth: 0 }));
    const halo = pts.add({ position: P(0, 0, 786000), pixelSize: 30, color: amber.withAlpha(0.16) });
    const packets = Array.from({ length: 3 * NPK }, () => pts.add({ position: P(0, 0), pixelSize: 3.5, color: teal, show: false }));
    const foot = v.entities.add({ position: P(0, 0), ellipse: { semiMajorAxis: SW_DEG * 111000, semiMinorAxis: SW_DEG * 111000, material: amber.withAlpha(0.14), outline: true, outlineColor: amber.withAlpha(0.5), height: 0 } });
    const sat3 = createSatellite(v.scene), sat = { position: P(0, 0, 786000) } as { position: Cartesian3 };
    const dishes = v.scene.primitives.add(new BillboardCollection({ scene: v.scene })), labels = v.scene.primitives.add(new LabelCollection({ scene: v.scene }));
    const caps = new Map<string, any>(), R = capRangeM(), cyan = Color.fromCssColorString("#22D3EE");
    for (const s of data.stations) {
      dishes.add({ position: P(s.lon, s.lat, 20000), image: DISH_ICON, verticalOrigin: VerticalOrigin.BOTTOM, scaleByDistance: new NearFarScalar(2e6, 1, 5e7, 0.6) });
      labels.add({ position: P(s.lon, s.lat, 20000), text: s.name.split(" (")[0], font: "500 12px Geist, sans-serif", fillColor: Color.fromCssColorString("#E6EDF3"), outlineColor: Color.fromCssColorString("#0A0E14"), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(10, 2), scaleByDistance: new NearFarScalar(2e6, 1, 5e7, 0.7) });
      caps.set(s.id, v.entities.add({ position: P(s.lon, s.lat), ellipse: { semiMajorAxis: R, semiMinorAxis: R, material: cyan.withAlpha(0.07), outline: true, outlineColor: cyan.withAlpha(0.4), height: 0 } }));
    }
    const lines = v.scene.primitives.add(new PolylineCollection());
    const mat = (c: Color) => Material.fromType("Color", { color: c });
    const trail = Array.from({ length: SEGS }, (_, j) => lines.add({ positions: [P(0, 0), P(1, 1)], width: 2.2, material: mat(amber.withAlpha(0.8 * Math.pow(1 - j / SEGS, 1.2) + 0.15)), show: false }));
    const swath = lines.add({ positions: [P(0, 0), P(1, 1)], width: 4, material: mat(amber), show: false });
    const nadir = lines.add({ positions: [P(0, 0), P(1, 1)], width: 1, material: mat(Color.WHITE.withAlpha(0.35)), show: false });
    const dash = () => Material.fromType("PolylineDash", { color: teal.withAlpha(0.75), gapColor: Color.TRANSPARENT, dashLength: 14, dashPattern: 255 }); // one material per line: shared ones are destroyed twice
    const arcs = Array.from({ length: 3 }, () => lines.add({ positions: [P(0, 0), P(1, 1)], width: 2, material: dash(), show: false }));
    // intro: wide shot, then an eased 3 s fly-in once the first tiles are in; follow starts when it lands
    const [lon0, lat0] = interp(data.track, t0);
    const rd = { ok: false, intro: false, flown: false };
    v.camera.setView({ destination: P(lon0, lat0 * 0.8, reduced() ? 1.15e7 : 4.5e7) });
    if (reduced()) rd.intro = true;
    v.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
      if (n !== 0) return; rd.ok = true; (window as any).__herald = { ...(window as any).__herald, globeReady: true };
      if (!rd.flown && !reduced()) { rd.flown = true; v.camera.flyTo({ destination: P(lon0, lat0 * 0.8, 1.15e7), duration: 3, easingFunction: EasingFunction.CUBIC_IN_OUT, complete: () => { rd.intro = true; } }); }
    });
    scene.current = { sat3, caps, capOn: new Map<string, boolean>(), rd, sat, halo, foot, packets, stPts, trail, swath, nadir, arcs };
    viewer.current = v; (window as any).__herald = { globeReady: false, layers: {} };
    const off = () => { followRef.current = false; setFollow(false); if (closeRef.current) { closeRef.current = false; v.camera.lookAtTransform(Matrix4.IDENTITY); } };
    const el = v.canvas; el.addEventListener("pointerdown", off);
    return () => { el.removeEventListener("pointerdown", off); v.useDefaultRenderLoop = false; v.camera.cancelFlight(); v.destroy(); viewer.current = null; scene.current = {}; };
  }, [data.track, data.stations, aois, t0]);

  // layer markers: Track A construction leads (sites_blr), Track A solar cells (siting), Track C evidence cases
  useEffect(() => {
    const v = viewer.current; if (!v || v.isDestroyed()) return;
    const S = scene.current, pc = v.scene.primitives, A = Color.fromCssColorString("#F5A524"), Cc = Color.fromCssColorString("#34D399");
    const mkp = (list: { lat: number; lon: number }[], color: Color, px: number, ow: number) => { const c = pc.add(new PointPrimitiveCollection()); for (const p of list) c.add({ position: P(p.lon, p.lat, 3000), pixelSize: px, color, outlineColor: Color.fromCssColorString("#0A0E14"), outlineWidth: ow }); return c as PointPrimitiveCollection; };
    S.lay = {
      leads: mkp((data.reports.sites_blr?.sites ?? []).filter((s: any) => s.category !== "agri_ambiguous"), A.withAlpha(0.85), 4, 1),
      solar: mkp(siting?.top_solar ?? [], A, 11, 2),
      evidence: mkp(data.reports.evidence?.cards ?? [], Cc, 8, 2),
    };
    return () => { if (!v.isDestroyed()) for (const c of Object.values(S.lay ?? {})) pc.remove(c as any); S.lay = null; };
  }, [siting, data.reports, data.track, data.stations, aois, t0]);
  useEffect(() => {
    const v = viewer.current, S = scene.current; if (!v || v.isDestroyed() || !S.lay) return;
    const n: Record<string, number> = {};
    for (const k of ["leads", "solar", "evidence"]) { S.lay[k].show = layers[k]; n[k] = layers[k] ? S.lay[k].length : 0; }
    for (const id of aois.keys()) { const e = v.entities.getById(id); if (e) e.show = layers.aoi; }
    S.caps.forEach((e: any) => { e.show = layers.coverage; });
    n.aoi = layers.aoi ? aois.size : 0; n.coverage = layers.coverage ? S.caps.size : 0;
    (window as any).__herald = { ...(window as any).__herald, layers: n };
    v.scene.requestRender();
  }, [layers, siting, data.reports, data.track, data.stations, aois, t0]);

  const bytesRef = useRef<{ b: number[]; max: number }>({ b: [], max: 1 });
  // hidden tab: stop Cesium's render loop entirely, resume when shown
  useEffect(() => { const v = viewer.current; if (v && !v.isDestroyed()) { v.useDefaultRenderLoop = shown; if (shown) v.scene.requestRender(); } }, [shown]);
  const wRef = useRef(wins); wRef.current = wins;
  const stRef = useRef(data.stations); stRef.current = data.stations;
  useEffect(() => {
    let raf = 0, last = performance.now(), ui = 0, tr = 0;
    const [la0, lo0] = interp(data.track, tRef.current); let cl = lo0, cb = la0 * 0.8;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const S = scene.current, v = viewer.current;
      if (!S.sat || !v || !shownRef.current) return;
      if (play) tRef.current = (tRef.current + (dt * SPEEDS[speed]) / 60) % tEnd;
      const tt = tRef.current;
      const [lat, lon] = interp(data.track, tt);
      const sp = P(lon, lat, 786000); S.sat.position = sp; S.halo.position = sp;
      { const [la3, lo3] = interp(data.track, tt + 0.2), dist = Cartesian3.distance(v.camera.positionWC, sp), cam = v.camera.frustum as any;
        S.sat3.update(sp, P(lo3, la3, 786000), (dist * 2 * Math.tan((cam.fovy ?? 1) / 2)) / v.canvas.clientHeight, dist < 6e6); }
      if (epochRef.current) v.clock.currentTime = JulianDate.addSeconds(epochRef.current, tt * 60, new JulianDate());
      if (now - tr > 90 || !play) {
        tr = now;
        // trail: SEGS segments, newest first, each fades; swath line is perpendicular to heading
        for (let j = 0; j < SEGS; j++) {
          const a = tt - (j * TRAIL_MIN) / SEGS, pos: Cartesian3[] = [];
          for (let k = 0; k <= 5; k++) { const [la, lo] = interp(data.track, a - (k * TRAIL_MIN) / SEGS / 5); pos.push(P(lo, la, 4000)); }
          S.trail[j].positions = pos; S.trail[j].show = true;
        }
        const [la2, lo2] = interp(data.track, tt + 0.3);
        const c = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
        let dx = (lo2 - lon) * c, dy = la2 - lat; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
        S.swath.positions = [P(lon + (dy * SW_DEG) / c, lat - dx * SW_DEG, 4000), P(lon - (dy * SW_DEG) / c, lat + dx * SW_DEG, 4000)]; S.swath.show = true;
        S.nadir.positions = [sp, P(lon, lat, 0)]; S.nadir.show = true;
        S.foot.position = new ConstantPositionProperty(P(lon, lat));
      }
      const act = wRef.current.filter((w) => tt >= w.start_min && tt < w.end_min);
      const ph = 0.5 + 0.5 * Math.sin(now / 260);
      const on = new Set(act.map((w) => w.station));
      for (const [id, p] of S.stPts as Map<string, any>) {
        const live = on.has(id);
        p.pixelSize = live && !reduced() ? 9 + 2 * ph : live ? 10 : 8;
        if (S.capOn.get(id) !== live) { S.capOn.set(id, live); const e = S.caps.get(id).ellipse; e.material = Color.fromCssColorString("#22D3EE").withAlpha(live ? 0.26 : 0.07); e.outlineColor = Color.fromCssColorString("#22D3EE").withAlpha(live ? 0.9 : 0.4); }
        p.outlineWidth = live ? 2 + 7 * (reduced() ? 0.5 : ph) : 0; p.outlineColor = teal.withAlpha(live ? 0.55 - 0.4 * ph : 0);
      }
      S.arcs.forEach((a: any, i: number) => {
        const w = act[i], st = w && stRef.current.find((s) => s.id === w.station);
        a.show = !!st; if (st) a.positions = [sp, P(st.lon, st.lat, 0)];
        // packet dots stream sat -> station; their speed follows the bytes HERALD scheduled in this window
        const bw = w ? bytesRef.current.b[wRef.current.indexOf(w)] ?? 0 : 0, rate = 0.25 + 1.4 * (bw / bytesRef.current.max);
        for (let k = 0; k < NPK; k++) {
          const pk = S.packets[i * NPK + k]; pk.show = !!st;
          if (st) pk.position = Cartesian3.lerp(sp, P(st.lon, st.lat, 0), (((now / 1000) * rate + k / NPK) % 1 + 1) % 1, new Cartesian3());
        }
      });
      if (closeRef.current) { const [la4, lo4] = interp(data.track, tt + 0.2); v.camera.lookAt(sp, new HeadingPitchRange(Math.atan2((lo4 - lon) * Math.cos((lat * Math.PI) / 180), la4 - lat) + 2.4, -0.45, 9e5)); }
      else if (followRef.current && S.rd.intro) {
        const dl = ((lon - cl + 540) % 360) - 180;
        cl = (cl + dl * Math.min(1, dt * 3) + 540) % 360 - 180; cb += (Math.max(-55, Math.min(55, lat * 0.8)) - cb) * Math.min(1, dt * 3);
        v.camera.setView({ destination: P(cl, cb, 1.15e7) });
      } else { cl = lon; cb = lat * 0.8; }
      if (play || (followRef.current && S.rd.intro) || on.size) v.scene.requestRender(); // idle (paused, no live pass): Cesium renders only on camera or tile changes
      if (now - ui > 100) { ui = now; setT(tt); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [play, speed, tEnd, data.track]);

  const fly = (name: string) => {
    const v = viewer.current; if (!v) return; setFollow(false); followRef.current = false;
    const d = reduced() ? 0 : 1.8, easingFunction = EasingFunction.CUBIC_IN_OUT;
    if (closeRef.current) { closeRef.current = false; v.camera.lookAtTransform(Matrix4.IDENTITY); }
    if (name === "Satellite") { v.camera.cancelFlight(); closeRef.current = true; return; }
    if (name === "Globe") { const [la, lo] = interp(data.track, tRef.current); return v.camera.flyTo({ destination: P(lo, la * 0.8, 3.2e7), duration: d, easingFunction }); }
    if (name === "India") return v.camera.flyTo({ destination: Rectangle.fromDegrees(64, 4, 100, 38), duration: d, easingFunction });
    const b = name === "pavagada" ? (siting?.bbox as number[] | undefined) : aois.get(name);
    if (!b) return;
    const pad = 0.12, [w, so, e, n] = name === "pavagada" ? b : b; v.camera.flyTo({ destination: Rectangle.fromDegrees(w - pad, so - pad, e + pad, n + pad), duration: d, easingFunction });
  };
  const presets = ["Globe", "India", "Satellite", ...[...aois.keys(), ...(siting?.bbox ? ["pavagada"] : [])]];
  const active = wins.find((w) => t >= w.start_min && t < w.end_min);
  const next = wins.filter((w) => w.start_min > t).sort((a, b) => a.start_min - b.start_min)[0];
  const stName = useMemo(() => new Map(data.stations.map((s) => [s.id, s.name])), [data.stations]);
  const tl = out?.results.H2.timeline;
  const cd = active ? active.end_min - t : next ? next.start_min - t : null;
  const rel = t - t0;
  const perPass = useMemo(() => wins.map((p) => { let b = 0, c = 0; if (tl) splits.forEach((s, i) => { if (s.station === p.station && s.start_min >= p.start_min - 1e-3 && s.end_min <= p.end_min + 1e-3) { b += tl.bytes[i]; c += tl.cap[i]; } }); return { bytes: b, cap: c }; }), [wins, splits, tl]);
  bytesRef.current = { b: perPass.map((x) => x.bytes), max: Math.max(1, ...perPass.map((x) => x.bytes)) };
  useEffect(() => {
    const ul = lis.current, li = ul?.querySelector<HTMLElement>("li.live, li.nxt"); if (!ul || !li) return;
    ul.scrollTo({ top: li.offsetTop - ul.clientHeight / 3, behavior: reduced() ? "auto" : "smooth" });
  }, [active, next]);
  const insights = useMemo<Insight[]>(() => {
    const a = buildInsights(data, out), top = siting?.top_solar?.[0];
    if (top) a.unshift({ id: "pav", track: "A", aoi: "pavagada", title: `Top solar site, ${top.mw} MW`, sub: `Pavagada, ${inr(top.net_value_rs_yr)}/yr net (assumption)`, lat: top.lat, lon: top.lon, capMin: -1, img: "", to: "siting", herald: null, fifo: null });
    return a;
  }, [data, out, siting]);
  const shownIns = insights.filter((x) => x.capMin <= t).sort((a, b) => b.capMin - a.capMin);
  const nextIns = insights.find((x) => x.capMin > t);
  const seek = (x: number) => { tRef.current = x; setT(x); };
  const flyTo = (lon: number, lat: number, h = 1.5e5) => { const v = viewer.current; if (!v) return; followRef.current = false; setFollow(false); v.camera.flyTo({ destination: P(lon, lat, h), duration: reduced() ? 0 : 1.8, easingFunction: EasingFunction.CUBIC_IN_OUT }); };
  const spark = useMemo(() => {
    const H = out?.results.H2.timeline.cum_value, F = out?.results.B1.timeline.cum_value; if (!H || !F) return null;
    const mx = Math.max(1, H[H.length - 1] ?? 1, F[F.length - 1] ?? 1), W = 200, Hh = 40, x = (m: number) => ((m - t0) / (tEnd - t0)) * W, y = (v: number) => Hh - (v / mx) * (Hh - 2) - 1;
    const path = (c: number[]) => `M${x(t0).toFixed(1)},${y(0)} ` + c.map((v, i) => `L${x(Math.max(t0, splits[i].end_min)).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return { h: path(H), f: path(F), W, Hh, x, H, F };
  }, [out, splits, t0, tEnd]);
  const sparkAt = (c: number[]) => { let k = -1; while (k + 1 < splits.length && splits[k + 1].end_min <= t) k++; return k < 0 ? 0 : c[k]; };
  const tourGo = (k: number | null) => {
    setTour(k); if (k == null) return; const [, to] = TOUR[k]; fly(to);
    if (k === 4) { const nx = insights.find((x) => x.herald); if (nx) seek(Math.max(t0, nx.capMin - 1)); }
  };
  return (
    <div className="missionwrap cmd">
      <div className="cmdtop">
        <h1>Command center</h1>
        <span className="chip">{data.tiles.length.toLocaleString("en-IN")} tiles, {wins.length} windows</span>
        <span className="grow" />
        <label className="flyto">Fly to
          <select value="" onChange={(e) => { if (e.target.value) fly(e.target.value); e.target.value = ""; }} aria-label="Fly to">
            <option value="">Choose</option>{presets.map((p) => <option key={p} value={p}>{PRESET_NAMES[p] ?? p}</option>)}
          </select>
        </label>
        <button className={tour != null ? "on" : ""} onClick={() => tourGo(tour == null ? 0 : null)}>Story tour</button>
      </div>
      <div className="cmdgrid">
        <aside className="panel lay" aria-label="Layers">
          <h3>Layers</h3>
          {LAYERS.map(([k, label, tr]) => (
            <label key={k} className={`lyr ${layers[k] ? "" : "off"}`}>
              <input type="checkbox" data-layer={k} checked={layers[k]} onChange={() => setLayers({ ...layers, [k]: !layers[k] })} />
              <i className={`sw t${tr || "N"}`} /><span>{label}</span>
            </label>))}
          <div className="legendkey"><span><i className="sw tA" />Track A</span><span><i className="sw tB" />Track B</span><span><i className="sw tC" />Track C</span></div>
          <div className="capnote mono">Coverage cap: {(capRangeM() / 1000).toFixed(0)} km ground range at {EL_MIN} deg elevation, {ORBIT_KM} km orbit</div>
        </aside>
        <div className="globe" aria-label="Globe with satellite, recent ground track, stations and AOI boxes">
          <div className="gl" ref={box} />
          <div className={`hud ${active ? "live" : ""}`} aria-live="polite">
            {active ? <><i className="dot" />CONTACT <b>{stName.get(active.station) ?? active.station}</b>{cd != null && <span className="mono"> closes {(cd * 60).toFixed(0)} s</span>}</> : next ? <>NEXT <b>{stName.get(next.station) ?? next.station}</b> <span className="mono">in {Math.floor(cd!)} min</span></> : "no further passes"}
          </div>
          {tour != null && <div className="tour"><span className="mono dim">{tour + 1} / {TOUR.length}</span><p>{TOUR[tour][0]}</p>
            <div className="row"><button onClick={() => tourGo(null)}>Skip</button><button className="primary" onClick={() => tourGo(tour + 1 < TOUR.length ? tour + 1 : null)}>{tour + 1 < TOUR.length ? "Next" : "Done"}</button></div></div>}
        </div>
        <aside className="panel feed" aria-label="Live insight feed">
          <div className="seg tabs" role="tablist"><button role="tab" aria-selected={tab === "feed"} className={tab === "feed" ? "on" : ""} onClick={() => setTab("feed")}>Live insight feed</button>
            <button role="tab" aria-selected={tab === "wins"} className={tab === "wins" ? "on" : ""} onClick={() => setTab("wins")}>Contact windows</button></div>
          {tab === "feed" ? (
            <div className="cards" aria-live="polite">
              {nextIns && <div className="nextcap"><span>Next capture <b>T+{hm(Math.max(0, nextIns.capMin - t0))}</b> over {PRESET_NAMES[nextIns.aoi] ?? nextIns.aoi}</span>
                <button onClick={() => seek(Math.max(t0, nextIns.capMin - 0.5))}>Jump</button></div>}
              {shownIns.map((x) => (
                <article key={x.id} className={`ic t${x.track}`}>
                  {x.img ? <img src={x.img} alt="" width={64} height={64} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /> : <div className="noimg mono">{x.track}</div>}
                  <div className="ib">
                    <b>{x.title}</b><span className="dim">{x.sub}</span>
                    {x.capMin >= 0 ? (
                      <div className="tl mono">
                        <span>captured T+{hm(x.capMin - t0)}</span>
                        <span className="h">sent {x.herald ? `T+${hm(x.herald.min - t0)} via ${stName.get(x.herald.station)?.split(" (")[0] ?? x.herald.station}` : "-"} <em>HERALD</em></span>
                        <span className="f">{x.fifo ? `T+${hm(x.fifo.min - t0)}` : "not sent"} <em>FIFO</em></span>
                      </div>) : <div className="tl mono"><span>offline siting analysis</span></div>}
                    <div className="row"><button onClick={() => flyTo(x.lon, x.lat)}>Fly there</button><button onClick={() => { location.hash = `/${x.to}`; }}>Open details</button></div>
                  </div>
                </article>))}
              {!shownIns.length && <p className="dim">No captures yet. Press play, or jump to the next one.</p>}
            </div>
          ) : (
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
            </ul>)}
        </aside>
      </div>
      <div className="cbar">
        <button className="primary" onClick={() => setPlay(!play)} aria-pressed={play}>{play ? "Pause" : "Play"}</button>
        <div className="mono ck">T+{hm(Math.max(0, rel))}</div>
        <div className="seg" aria-label="speed">{SPEEDS.map((s, i) => <button key={s} className={speed === i ? "on" : ""} onClick={() => setSpeed(i)} aria-pressed={speed === i}>{s}x</button>)}</div>
        <div className="scrub">
          <input type="range" min={t0} max={tEnd} step={0.5} value={Math.min(Math.max(t, t0), tEnd)} onChange={(e) => seek(+e.target.value)} aria-label="Timeline" />
          <div className="ticks" aria-hidden="true">
            {wins.map((w, k) => <i key={k} className={active === w ? "live" : ""} style={{ left: `${((w.start_min - t0) / (tEnd - t0)) * 100}%` }} />)}
            {insights.filter((x) => x.capMin >= 0).map((x) => <i key={x.id} className={`cap t${x.track}`} style={{ left: `${((x.capMin - t0) / (tEnd - t0)) * 100}%` }} />)}
          </div>
        </div>
        <div className="spark" title="Cumulative value delivered (assumed rupee value model)">
          <div className="sl"><span>Value delivered</span>{spark && <span className="mono"><b className="B">HERALD {inr(sparkAt(spark.H))}</b> <b className="F">FIFO {inr(sparkAt(spark.F))}</b></span>}</div>
          {spark && <svg viewBox={`0 0 ${spark.W} ${spark.Hh}`} preserveAspectRatio="none" width="100%" height="36"><path d={spark.f} className="pf" /><path d={spark.h} className="ph" />
            <line x1={spark.x(t)} x2={spark.x(t)} y1="0" y2={spark.Hh} className="pc" /></svg>}
        </div>
      </div>
    </div>
  );
}
