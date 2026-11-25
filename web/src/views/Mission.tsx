import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cartesian2, Cartesian3, Color, HorizontalOrigin, Ion, ImageryLayer, LabelStyle, Material, PointPrimitiveCollection, PolylineCollection,
  Rectangle, TileMapServiceImageryProvider, VerticalOrigin, Viewer, buildModuleUrl, ScreenSpaceEventType,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { ViewProps } from "./props";
import { bytes, hm } from "../fmt";
import { ViewHead } from "../ui";
import { reduced } from "../anim";

Ion.defaultAccessToken = "";

const SPEEDS = [1, 10, 60, 300, 1200]; // sim seconds per wall second
const TRAIL_MIN = 100, SEGS = 8, LEAD_MIN = 5; // display only: about one orbit of trail, fading in 8 steps; clock starts 5 min before first contact
const SW_DEG = 1.3; // half swath in degrees, display only (about 145 km)
const amber = Color.fromCssColorString("#f2a93b"), teal = Color.fromCssColorString("#6fd3c0");
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

export default function Mission({ data, out }: ViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const scene = useRef<any>({});
  const wins = data.wins;
  const t0 = useMemo(() => Math.max(0, (wins[0]?.start_min ?? 0) - LEAD_MIN), [wins]);
  const [t, setT] = useState(t0);
  const [play, setPlay] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [follow, setFollow] = useState(true);
  const tRef = useRef(t0), followRef = useRef(true), lis = useRef<HTMLUListElement>(null);
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
    const v = new Viewer(box.current!, {
      baseLayer: ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"))),
      geocoder: false, baseLayerPicker: false, animation: false, timeline: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true,
      maximumRenderTimeChange: Infinity, shouldAnimate: false, skyBox: false, skyAtmosphere: false, creditContainer: document.createElement("div"),
    });
    v.scene.globe.enableLighting = false; v.scene.globe.showWaterEffect = false;
    v.scene.backgroundColor = Color.fromCssColorString("#0b0e12");
    v.scene.globe.baseColor = Color.fromCssColorString("#10151c");
    v.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    // AOI boxes + points; labels alternate side (sorted north to south) so sone/hasdeo and blr/pavagada never overlap
    const sorted = [...aois].sort((a, b) => b[1][1] - a[1][1]);
    sorted.forEach(([id, b], k) => {
      const up = k % 2 === 0;
      v.entities.add({ id, rectangle: { coordinates: Rectangle.fromDegrees(b[0], b[1], b[2], b[3]), material: Color.TRANSPARENT, outline: true, outlineColor: Color.WHITE.withAlpha(0.8), height: 0 },
        position: P((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), point: { pixelSize: 5, color: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 1 },
        label: { text: id, font: "12px ui-monospace, monospace", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: up ? HorizontalOrigin.LEFT : HorizontalOrigin.RIGHT, verticalOrigin: up ? VerticalOrigin.BOTTOM : VerticalOrigin.TOP,
          pixelOffset: new Cartesian2(up ? 9 : -9, up ? -8 : 8), disableDepthTestDistance: Infinity } });
    });
    const pts = v.scene.primitives.add(new PointPrimitiveCollection());
    const stPts = new Map<string, any>();
    for (const s of data.stations) stPts.set(s.id, pts.add({ position: P(s.lon, s.lat), pixelSize: 8, color: teal, outlineColor: teal.withAlpha(0), outlineWidth: 0 }));
    const sat = pts.add({ position: P(0, 0, 786000), pixelSize: 11, color: Color.WHITE, outlineColor: amber, outlineWidth: 3 });
    const lines = v.scene.primitives.add(new PolylineCollection());
    const mat = (c: Color) => Material.fromType("Color", { color: c });
    const trail = Array.from({ length: SEGS }, (_, j) => lines.add({ positions: [P(0, 0), P(1, 1)], width: 2.2, material: mat(amber.withAlpha(0.9 * Math.pow(1 - j / SEGS, 1.6) + 0.04)), show: false }));
    const swath = lines.add({ positions: [P(0, 0), P(1, 1)], width: 4, material: mat(amber), show: false });
    const nadir = lines.add({ positions: [P(0, 0), P(1, 1)], width: 1, material: mat(Color.WHITE.withAlpha(0.35)), show: false });
    const arcs = Array.from({ length: 3 }, () => lines.add({ positions: [P(0, 0), P(1, 1)], width: 2.5, material: mat(teal.withAlpha(0.95)), show: false }));
    scene.current = { sat, stPts, trail, swath, nadir, arcs };
    const [lon0, lat0] = interp(data.track, t0);
    v.camera.setView({ destination: P(lon0, lat0 * 0.6, 1.6e7) });
    viewer.current = v;
    const off = () => { followRef.current = false; setFollow(false); };
    const el = v.canvas; el.addEventListener("pointerdown", off);
    return () => { el.removeEventListener("pointerdown", off); v.destroy(); viewer.current = null; };
  }, [data.track, data.stations, aois, t0]);

  const wRef = useRef(wins); wRef.current = wins;
  const stRef = useRef(data.stations); stRef.current = data.stations;
  useEffect(() => {
    let raf = 0, last = performance.now(), ui = 0, tr = 0;
    const [la0, lo0] = interp(data.track, tRef.current); let cl = lo0, cb = la0 * 0.6;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const S = scene.current, v = viewer.current;
      if (!S.sat || !v) return;
      if (play) tRef.current = (tRef.current + (dt * SPEEDS[speed]) / 60) % tEnd;
      const tt = tRef.current;
      const [lat, lon] = interp(data.track, tt);
      S.sat.position = P(lon, lat, 786000);
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
        S.nadir.positions = [P(lon, lat, 786000), P(lon, lat, 0)]; S.nadir.show = true;
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
        a.show = !!st; if (st) a.positions = [P(lon, lat, 786000), P(st.lon, st.lat, 0)];
      });
      if (followRef.current) {
        const dl = ((lon - cl + 540) % 360) - 180;
        cl = (cl + dl * Math.min(1, dt * 3) + 540) % 360 - 180; cb += (Math.max(-55, Math.min(55, lat * 0.6)) - cb) * Math.min(1, dt * 3);
        v.camera.setView({ destination: P(cl, cb, 1.6e7) });
      } else { cl = lon; cb = lat * 0.6; }
      v.scene.requestRender();
      if (now - ui > 100) { ui = now; setT(tt); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [play, speed, tEnd, data.track]);

  const active = wins.find((w) => t >= w.start_min && t < w.end_min);
  const next = wins.filter((w) => w.start_min > t).sort((a, b) => a.start_min - b.start_min)[0];
  const stName = useMemo(() => new Map(data.stations.map((s) => [s.id, s.name])), [data.stations]);
  const tl = out?.results.H2.timeline;
  const cd = active ? active.end_min - t : next ? next.start_min - t : null;
  const rel = t - t0;
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
            <div className="controls">{SPEEDS.map((s, i) => <button key={s} className={speed === i ? "on" : ""} onClick={() => setSpeed(i)} aria-pressed={speed === i}>{s}x</button>)}</div>
            <div className="countdown">
              {active ? <>Contact <b>{stName.get(active.station) ?? active.station}</b> closes in <b className="mono">{(cd! * 60).toFixed(0)} s</b></>
                : next ? <>Next pass <b>{stName.get(next.station) ?? next.station}</b> in <b className="mono">{Math.floor(cd!)}m {String(Math.floor((cd! % 1) * 60)).padStart(2, "0")}s</b></> : "no further passes"}
            </div>
          </div>
          <h3>Contact windows <small>{wins.length}, HERALD at rho {out?.rho ?? "-"}</small></h3>
          <ul className="wins" tabIndex={0} aria-label="contact windows" ref={lis}>
            {wins.map((w, wi) => {
              const r = tl ? { bytes: tl.bytes[wi], cap: tl.cap[wi] } : null;
              return (
                <li key={wi} className={active === w ? "live" : w.end_min < t ? "past" : w === next ? "nxt" : ""}>
                  <span className="mono">{hm(w.start_min)}</span><span className="trunc">{stName.get(w.station) ?? w.station}</span>
                  <span className="mono r">{(w.end_min - w.start_min).toFixed(1)} min</span>
                  <span className="mono r dim">{r ? `${bytes(r.bytes)} / ${bytes(r.cap)}` : "-"}</span>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
