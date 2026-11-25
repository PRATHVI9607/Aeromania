import { BillboardCollection, BoxGeometry, Cartesian3, Color, EllipsoidGeometry, GeometryInstance, Material, MaterialAppearance, Matrix3, Matrix4, PerInstanceColorAppearance, Primitive, ColorGeometryInstanceAttribute, VertexFormat, VerticalOrigin, type Scene } from "cesium";

export const svgUrl = (body: string, w: number, h: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
/** crisp far-field satellite icon: gold bus, two blue panels */
export const SAT_ICON = svgUrl(`<rect x="2" y="12" width="14" height="8" rx="1" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1"/><rect x="32" y="12" width="14" height="8" rx="1" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1"/><rect x="17" y="8" width="14" height="16" rx="2" fill="#d4a63a" stroke="#fff" stroke-width="1.5"/><circle cx="24" cy="28" r="3" fill="#e6edf3"/>`, 48, 32);
/** ground-station dish icon */
export const DISH_ICON = svgUrl(`<path d="M5 6 L19 18 A12 12 0 0 1 5 6 Z" fill="#22D3EE" stroke="#0A0E14" stroke-width="1.5"/><path d="M12 16 L12 22 M7 22 H17" stroke="#22D3EE" stroke-width="2.5" stroke-linecap="round"/><circle cx="19" cy="6" r="2" fill="#E6EDF3"/>`, 24, 26);

const U = { bus: [2.4, 1.6, 1.6], span: 11.6 }; // local units; x along-track, y cross-track, z up
function panelTexture(): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = 128; c.height = 64; const g = c.getContext("2d")!;
  g.fillStyle = "#10285c"; g.fillRect(0, 0, 128, 64); g.strokeStyle = "#4f7fd6"; g.lineWidth = 1.5;
  for (let x = 0; x <= 128; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
  for (let y = 0; y <= 64; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.strokeStyle = "#8fb2ec"; g.lineWidth = 3; g.strokeRect(0, 0, 128, 64);
  return c;
}
const T = (x: number, y: number, z: number) => Matrix4.fromTranslation(new Cartesian3(x, y, z));
const box = (dx: number, dy: number, dz: number, fmt: VertexFormat) => new BoxGeometry({ minimum: new Cartesian3(-dx / 2, -dy / 2, -dz / 2), maximum: new Cartesian3(dx / 2, dy / 2, dz / 2), vertexFormat: fmt });

/** Satellite from Cesium primitives: gold-foil box bus, two cell-textured panels, nadir dish. Far away it swaps to a billboard icon. */
export function createSatellite(scene: Scene) {
  const [bx, by, bz] = U.bus;
  const bus = new Primitive({ asynchronous: false, appearance: new PerInstanceColorAppearance({ closed: true, translucent: false }), modelMatrix: Matrix4.IDENTITY, geometryInstances: [
    new GeometryInstance({ geometry: box(bx, by, bz, PerInstanceColorAppearance.VERTEX_FORMAT), attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString("#cfa23a")) } }),
    new GeometryInstance({ geometry: new EllipsoidGeometry({ radii: new Cartesian3(0.7, 0.7, 0.22), vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: T(0, 0, -bz / 2 - 0.25), attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString("#e6edf3")) } }),
    new GeometryInstance({ geometry: box(0.12, 0.12, 0.5, PerInstanceColorAppearance.VERTEX_FORMAT), modelMatrix: T(0, 0, -bz / 2 - 0.05), attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString("#8A97A8")) } }),
    new GeometryInstance({ geometry: box(0.1, 1.4, 0.1, PerInstanceColorAppearance.VERTEX_FORMAT), modelMatrix: T(0, 0, 0), attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString("#8A97A8")) } }),
  ] });
  const pf = MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat;
  const panels = new Primitive({ asynchronous: false, modelMatrix: Matrix4.IDENTITY,
    appearance: new MaterialAppearance({ material: Material.fromType("Image", { image: panelTexture() }), materialSupport: MaterialAppearance.MaterialSupport.TEXTURED, translucent: false, closed: true }),
    geometryInstances: [-1, 1].map((s) => new GeometryInstance({ geometry: box(2.2, 4.4, 0.07, pf), modelMatrix: T(0, s * (by / 2 + 0.25 + 2.2), 0) })) });
  const prims = scene.primitives; prims.add(bus); prims.add(panels);
  const icon = new BillboardCollection({ scene }); const bb = icon.add({ position: Cartesian3.ZERO, image: SAT_ICON, verticalOrigin: VerticalOrigin.CENTER, scale: 1 }); prims.add(icon);
  const m3 = new Matrix3(), m4 = new Matrix4(), Z = new Cartesian3(), X = new Cartesian3(), Y = new Cartesian3(), S = new Matrix4();
  return {
    bb,
    /** pos/ahead: ECEF of satellite and a point a moment later; metres-per-pixel scaling keeps the model about 60 px wide */
    update(pos: Cartesian3, ahead: Cartesian3, mpp: number, showModel: boolean) {
      bb.position = pos; bb.show = !showModel; bus.show = panels.show = showModel;
      if (!showModel) return;
      Cartesian3.normalize(pos, Z); Cartesian3.subtract(ahead, pos, X); Cartesian3.normalize(X, X);
      Cartesian3.multiplyByScalar(Z, Cartesian3.dot(X, Z), Y); Cartesian3.subtract(X, Y, X); Cartesian3.normalize(X, X); // along-track, made horizontal
      Cartesian3.cross(Z, X, Y);
      Matrix3.setColumn(Matrix3.IDENTITY, 0, X, m3); Matrix3.setColumn(m3, 1, Y, m3); Matrix3.setColumn(m3, 2, Z, m3);
      Matrix4.fromRotationTranslation(m3, pos, m4);
      const k = Math.max(1, (mpp * 90) / U.span); Matrix4.multiply(m4, Matrix4.fromUniformScale(k, S), m4);
      bus.modelMatrix = m4; panels.modelMatrix = Matrix4.clone(m4, panels.modelMatrix);
    },
  };
}
