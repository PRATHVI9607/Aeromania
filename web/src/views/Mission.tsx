import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cartesian2, Cartesian3, Color, ConstantPositionProperty, EasingFunction, HorizontalOrigin, JulianDate, LabelStyle, Material, PointPrimitiveCollection, PolylineCollection,
  Rectangle, VerticalOrigin, Viewer, ScreenSpaceEventType,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { ViewProps } from "./props";
import { bytes, hm } from "../fmt";
import { ViewHead } from "../ui";
import { reduced } from "../anim";
import { useJson } from "../useJson";
import { makeEarth } from "../cz";


const SPEEDS = [1, 10, 60, 300, 1200]; // sim seconds per wall second
const TRAIL_MIN = 100, SEGS = 8, LEAD_MIN = 5; // display only: about one orbit of trail, fading in 8 steps; clock starts 5 min before first contact
const SW_DEG = 1.3; // half swath in degrees, display only (about 145 km)
const amber = Color.fromCssColorString("#f2a93b"), teal = Color.fromCssColorString("#6fd3c0");
const PRESET_NAMES: Record<string, string> = { blr: "Bengaluru", sone: "Sone", hasdeo: "Hasdeo", pavagada: "Pavagada" };
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
  const t0 = useMemo(() => Math.max(0, ((wins.find((w) => w.station === "bengaluru") ?? wins[0])?.start_min ?? 0) - LEAD_MIN), [wins]);
  const [t, setT] = useState(t0);
  const [play, setPlay] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [follow, setFollow] = useState(true);
  const tRef = useRef(t0), followRef = useRef(true), lis = useRef<HTMLUListElement>(null);
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
    const sat = pts.add({ position: P(0, 0, 786000), pixelSize: 11, color: Color.WHITE, outlineColor: amber, outlineWidth: 3 });
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
    v.camera.setView({ destination: P(lon0, lat0 * 0.8, reduced() ? 1.6e7 : 4.5e7) });
    if (reduced()) rd.intro = true;
    v.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
      if (n !== 0) return; rd.ok = true; (window as any).__herald = { ...(window as any).__herald, globeReady: true };
      if (!rd.flown && !reduced()) { rd.flown = true; v.camera.flyTo({ destination: P(lon0, lat0 * 0.8, 1.6e7), duration: 3, easingFunction: EasingFunction.CUBIC_IN_OUT, complete: () => { rd.intro = true; } }); }
    });
    scene.current = { rd, sat, halo, foot, packets, stPts, trail, swath, nadir, arcs };
    viewer.current = v; (window as any).__herald = { globeReady: false, layers: {} };
    const off = () => { followRef.current = false; setFollow(false); };
    const el = v.canvas; el.addEventListener("pointerdown", off);
    return () => { el.removeEventListener("pointerdown", off); v.useDefaultRenderLoop = false; v.camera.cancelFlight(); v.destroy(); viewer.current = null; scene.current = {}; };
  }, [data.track, data.stations, aois, t0]);

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
      if (followRef.current && S.rd.intro) {
        const dl = ((lon - cl + 540) % 360) - 180;
        cl = (cl + dl * Math.min(1, dt * 3) + 540) % 360 - 180; cb += (Math.max(-55, Math.min(55, lat * 0.8)) - cb) * Math.min(1, dt * 3);
        v.camera.setView({ destination: P(cl, cb, 1.6e7) });
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
    if (name === "Globe") { const [la, lo] = interp(data.track, tRef.current); return v.camera.flyTo({ destination: P(lo, la * 0.8, 3.2e7), duration: d, easingFunction }); }
    if (name === "India") return v.camera.flyTo({ destination: Rectangle.fromDegrees(64, 4, 100, 38), duration: d, easingFunction });
    const b = name === "pavagada" ? (siting?.bbox as number[] | undefined) : aois.get(name);
    if (!b) return;
    const pad = 0.12, [w, so, e, n] = name === "pavagada" ? b : b; v.camera.flyTo({ destination: Rectangle.fromDegrees(w - pad, so - pad, e + pad, n + pad), duration: d, easingFunction });
  };
  const presets = ["Globe", "India", ...[...aois.keys(), ...(siting?.bbox ? ["pavagada"] : [])]];
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
  return (
    <div className="missionwrap">
      <ViewHead kicker="Track B, mission control" title="Every scarce minute of ground-station contact, spent on the answers that matter most"
        sub="The recent ground track fades behind the satellite. Stations pulse and a contact arc draws while a pass is live." />
      <div className="mission">
        <div className="globe" aria-label="Globe with satellite, recent ground track, stations and AOI boxes">
          <div className="gl" ref={box} />
          <div className={`hud ${active ? "live" : ""}`} aria-live="polite">
            {active ? <><i className="dot" />CONTACT <b>{stName.get(active.station) ?? active.station}</b></> : next ? <>NEXT <b>{stName.get(next.station) ?? next.station}</b></> : "no further passes"}
          </div>
        </div>
        <aside className="panel side">
          <div className="clock">
            <div className="mono big">T+{hm(Math.max(0, rel))}</div>
            <div className="controls">
              <button onClick={() => setPlay(!play)} aria-pressed={play}>{play ? "pause" : "play"}</button>
              <button onClick={() => { tRef.current = t0; setT(t0); }}>restart</button>
              <button className={follow ? "on" : ""} onClick={() => setFollow(!follow)} aria-pressed={follow}>follow</button>
            </div>
            <div className="controls" aria-label="camera presets">{presets.map((p) => <button key={p} onClick={() => fly(p)}>{PRESET_NAMES[p] ?? p}</button>)}</div>
            <div className="controls">{SPEEDS.map((s, i) => <button key={s} className={speed === i ? "on" : ""} onClick={() => setSpeed(i)} aria-pressed={speed === i}>{s}x</button>)}</div>
            <div className="countdown">
              {active ? <>Contact <b>{stName.get(active.station) ?? active.station}</b> closes in <b className="mono">{(cd! * 60).toFixed(0)} s</b></>
                : next ? <>Next pass <b>{stName.get(next.station) ?? next.station}</b> in <b className="mono">{Math.floor(cd!)}m {String(Math.floor((cd! % 1) * 60)).padStart(2, "0")}s</b></> : "no further passes"}
            </div>
          </div>
          <h3>Contact windows <small>{wins.length}, HERALD at rho {out?.rho ?? "-"}</small></h3>
          <ul className="wins" tabIndex={0} aria-label="contact windows" ref={lis}>
            {wins.map((w, wi) => {
              const r = tl ? perPass[wi] : null;
              return (
                <li key={wi} className={active === w ? "live" : w.end_min < t ? "past" : w === next ? "nxt" : ""}>
                  <span className="mono">{hm(w.start_min)}</span><span className="trunc">{stName.get(w.station) ?? w.station}</span>
                  <span className="mono r">{(w.end_min - w.start_min).toFixed(1)} min</span>
                  <span className="mono r dim">{r ? `${bytes(active === w ? r.bytes * Math.min(1, (t - w.start_min) / (w.end_min - w.start_min)) : r.bytes)} / ${bytes(r.cap)}` : "-"}</span>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
