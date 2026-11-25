import { useEffect, useRef } from "react";
import { Cartesian3, Color, ColorGeometryInstanceAttribute, GeometryInstance, Material, MaterialAppearance, Math as CMath, PerInstanceColorAppearance, Primitive, Rectangle,
  RectangleGeometry, ScreenSpaceEventType, BoundingSphere, HeadingPitchRange, EasingFunction, Viewer } from "cesium";
import { makeViewer } from "../cz";
import { reduced } from "../anim";

export interface L3 { rank: number; lat: number; lon: number; ha: number; color: string }
const H_PER_HA = 30, H_MAX = 1800, H_MIN = 40; // display scale: metres of column per changed hectare

/** Changed tiles as extruded columns in one batched Primitive over the real 2025 mosaic; click a column to select the lead. */
export default function Ledger3D({ items, rect, imgUrl, selRank, onPick }: { items: L3[]; rect: [number, number, number, number]; imgUrl: string; selRank: number | null; onPick: (rank: number) => void }) {
  const box = useRef<HTMLDivElement>(null), vr = useRef<Viewer | null>(null), prim = useRef<Primitive | null>(null), last = useRef<number | null>(null);
  const pick = useRef(onPick); pick.current = onPick;
  const [w, s, e, n] = rect, lonc = (w + e) / 2, latc = (s + n) / 2;
  useEffect(() => {
    let dead = false;
    const rectangle = Rectangle.fromDegrees(w, s, e, n);
    const v = makeViewer(box.current!, false);
    // mosaic draped as a textured rectangle primitive (a single-tile imagery layer smears its edge pixels at oblique angles)
    v.scene.primitives.add(new Primitive({ asynchronous: false, appearance: new MaterialAppearance({ material: Material.fromType("Image", { image: imgUrl }), materialSupport: MaterialAppearance.MaterialSupport.TEXTURED, translucent: false, closed: false }),
      geometryInstances: new GeometryInstance({ geometry: new RectangleGeometry({ rectangle, height: 4, vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }) }));
    vr.current = v;
    const inst = items.map((o) => {
      const side = Math.max(110, Math.sqrt(o.ha * 1e4)), dl = side / 111000 / 2, dn = side / (111000 * Math.cos((o.lat * Math.PI) / 180)) / 2;
      return new GeometryInstance({ id: o.rank, attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(o.color).withAlpha(0.92)) },
        geometry: new RectangleGeometry({ rectangle: Rectangle.fromDegrees(o.lon - dn, o.lat - dl, o.lon + dn, o.lat + dl), height: 0, extrudedHeight: Math.min(H_MAX, Math.max(H_MIN, o.ha * H_PER_HA)), vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }) });
    });
    const p = new Primitive({ geometryInstances: inst, appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }), asynchronous: false });
    v.scene.primitives.add(p); prim.current = p;
    const span = Math.max(e - w, n - s) * 111000;
    v.camera.setView({ destination: Cartesian3.fromDegrees(lonc, latc, span * 3) });
    // eased tilt-in: about 45 degrees, camera south of the scene looking north
    v.camera.flyTo({ destination: Cartesian3.fromDegrees(lonc, latc - (span * 0.75) / 111000, span * 0.75), orientation: { heading: 0, pitch: CMath.toRadians(-45), roll: 0 },
      duration: reduced() ? 0 : 2.4, easingFunction: EasingFunction.CUBIC_IN_OUT });
    v.screenSpaceEventHandler.setInputAction((m: any) => { const o = v.scene.pick(m.position); if (o && typeof o.id === "number") pick.current(o.id); }, ScreenSpaceEventType.LEFT_CLICK);
    return () => { dead = true; if (!v.isDestroyed()) { v.camera.cancelFlight(); v.destroy(); } vr.current = null; prim.current = null; void dead; };
  }, [items, w, s, e, n, imgUrl]); // eslint-disable-line
  useEffect(() => {
    const v = vr.current, p = prim.current; if (!v || !p) return;
    const col = (r: number, c: Color) => { const a = p.getGeometryInstanceAttributes(r); if (a) a.color = ColorGeometryInstanceAttribute.toValue(c); };
    if (last.current !== null) { const o = items.find((x) => x.rank === last.current); if (o) col(o.rank, Color.fromCssColorString(o.color).withAlpha(0.92)); }
    const o = items.find((x) => x.rank === selRank); last.current = o ? o.rank : null;
    if (!o) return;
    col(o.rank, Color.WHITE);
    v.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(o.lon, o.lat, 0), 700), { offset: new HeadingPitchRange(0, CMath.toRadians(-45), 3500), duration: reduced() ? 0 : 1.3, easingFunction: EasingFunction.CUBIC_IN_OUT });
  }, [selRank, items]);
  return <div className="ledger3d" ref={box} aria-label="3D ledger: columns are changed tiles, height proportional to changed hectares" />;
}
