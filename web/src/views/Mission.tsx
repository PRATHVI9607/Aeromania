import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cartesian3, Color, Ion, ImageryLayer, PointPrimitiveCollection, Rectangle, TileMapServiceImageryProvider,
  Viewer, buildModuleUrl, Math as CMath, ScreenSpaceEventType,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { ViewProps } from "./props";
import { bytes, hm } from "../fmt";

Ion.defaultAccessToken = "";

const SPEEDS = [1, 10, 60, 300, 1200]; // sim seconds per wall second

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
  const sat = useRef<any>(null);
  const [t, setT] = useState(0);
  const [play, setPlay] = useState(true);
  const [speed, setSpeed] = useState(2);
  const tRef = useRef(0);
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
    // ground track (single polyline entity) as a degree array, split at the antimeridian
    const seg: number[][] = [[]];
    let prev: number | null = null;
    for (const p of data.track) {
      if (prev !== null && Math.abs(p.lon - prev) > 180) seg.push([]);
      seg[seg.length - 1].push(p.lon, p.lat); prev = p.lon;
    }
    for (const s of seg) if (s.length >= 4) v.entities.add({ polyline: { positions: Cartesian3.fromDegreesArray(s), width: 1.2, material: Color.fromCssColorString("#f2a93b").withAlpha(0.7), clampToGround: false } });
    for (const [id, b] of aois) v.entities.add({ id, rectangle: { coordinates: Rectangle.fromDegrees(b[0], b[1], b[2], b[3]), material: Color.TRANSPARENT, outline: true, outlineColor: Color.WHITE, height: 0 },
      position: Cartesian3.fromDegrees((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), label: { text: id, font: "11px ui-monospace, monospace", pixelOffset: { x: 0, y: -14 } as any, fillColor: Color.WHITE } });
    const pts = v.scene.primitives.add(new PointPrimitiveCollection());
    for (const s of data.stations) pts.add({ position: Cartesian3.fromDegrees(s.lon, s.lat, 0), pixelSize: 7, color: Color.fromCssColorString("#6fd3c0"), outlineColor: Color.BLACK, outlineWidth: 1 });
    sat.current = pts.add({ position: Cartesian3.fromDegrees(0, 0, 786000), pixelSize: 10, color: Color.WHITE, outlineColor: Color.fromCssColorString("#f2a93b"), outlineWidth: 2 });
    v.camera.setView({ destination: Cartesian3.fromDegrees(60, 20, 2.4e7) });
    viewer.current = v;
    return () => { v.destroy(); viewer.current = null; };
  }, [data.track, data.stations, aois]);

  useEffect(() => {
    let raf = 0, last = performance.now(), ui = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      if (play) tRef.current = (tRef.current + (dt * SPEEDS[speed]) / 60) % tEnd;
      const [lat, lon] = interp(data.track, tRef.current);
      if (sat.current) { sat.current.position = Cartesian3.fromDegrees(lon, lat, 786000); viewer.current?.scene.requestRender(); }
      if (now - ui > 100) { ui = now; setT(tRef.current); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [play, speed, tEnd, data.track]);

  const wins = data.wins;
  const active = wins.find((w) => t >= w.start_min && t < w.end_min);
  const next = wins.filter((w) => w.start_min > t).sort((a, b) => a.start_min - b.start_min)[0];
  const stName = useMemo(() => new Map(data.stations.map((s) => [s.id, s.name])), [data.stations]);
  const tl = out?.results.H2.timeline;
  const cd = active ? active.end_min - t : next ? next.start_min - t : null;
  void CMath;
  return (
    <div className="mission">
      <div className="globe" ref={box} aria-label="Globe with ground track, stations and AOI boxes" />
      <aside className="panel side">
        <div className="clock">
          <div className="mono big">T+{hm(t)}</div>
          <div className="controls">
            <button onClick={() => setPlay(!play)} aria-pressed={play}>{play ? "pause" : "play"}</button>
            {SPEEDS.map((s, i) => <button key={s} className={speed === i ? "on" : ""} onClick={() => setSpeed(i)} aria-pressed={speed === i}>{s}x</button>)}
          </div>
          <div className="countdown">
            {active ? <>contact <b>{stName.get(active.station) ?? active.station}</b> closes in <b className="mono">{(cd! * 60).toFixed(0)} s</b></>
              : next ? <>next pass <b>{stName.get(next.station) ?? next.station}</b> in <b className="mono">{Math.floor(cd!)}m {String(Math.floor((cd! % 1) * 60)).padStart(2, "0")}s</b></> : "no further passes"}
          </div>
        </div>
        <h3>Contact windows <small>{wins.length}, H2 at rho {out?.rho ?? "-"}</small></h3>
        <ul className="wins" tabIndex={0} aria-label="contact windows">
          {wins.map((w, wi) => {
            const r = tl ? { bytes: tl.bytes[wi], cap: tl.cap[wi] } : null;
            return (
              <li key={wi} className={active === w ? "live" : w.end_min < t ? "past" : ""}>
                <span className="mono">{hm(w.start_min)}</span><span>{stName.get(w.station) ?? w.station}</span>
                <span className="mono">{(w.end_min - w.start_min).toFixed(1)} min</span>
                <span className="mono">{r ? `${bytes(r.bytes)} / ${bytes(r.cap)}` : "-"}</span>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
