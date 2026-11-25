import { useEffect, useRef } from "react";
import { Cartesian3, Color, EasingFunction, ImageryLayer, PointPrimitiveCollection, Rectangle, SingleTileImageryProvider, Viewer } from "cesium";
import { makeViewer } from "../cz";
import { reduced } from "../anim";

/** Small globe that flies to an evidence site, drapes the t1 chip at its true bbox and pulses a marker. */
export default function SiteGlobe({ bbox, imgUrl, lat, lon }: { bbox: number[]; imgUrl: string; lat: number; lon: number }) {
  const box = useRef<HTMLDivElement>(null), vr = useRef<Viewer | null>(null), pt = useRef<any>(null), layer = useRef<ImageryLayer | null>(null);
  useEffect(() => {
    const v = makeViewer(box.current!); vr.current = v;
    v.camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, 2.2e7) });
    const pts = v.scene.primitives.add(new PointPrimitiveCollection());
    pt.current = pts.add({ position: Cartesian3.fromDegrees(lon, lat, 0), pixelSize: 8, color: Color.fromCssColorString("#f2a93b"), outlineColor: Color.fromCssColorString("#f2a93b").withAlpha(0.4), outlineWidth: 4 });
    let raf = 0;
    const loop = (now: number) => { raf = requestAnimationFrame(loop); const ph = 0.5 + 0.5 * Math.sin(now / 280); pt.current.outlineWidth = 2 + (reduced() ? 3 : 8 * ph); pt.current.outlineColor = Color.fromCssColorString("#f2a93b").withAlpha(0.6 - 0.45 * ph); v.scene.requestRender(); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); v.camera.cancelFlight(); v.destroy(); vr.current = null; };
  }, []); // eslint-disable-line
  useEffect(() => {
    const v = vr.current; if (!v || v.isDestroyed()) return;
    const [w, s, e, n] = bbox, rectangle = Rectangle.fromDegrees(w, s, e, n);
    let gone = false;
    SingleTileImageryProvider.fromUrl(imgUrl, { rectangle }).then((p) => {
      if (gone || v.isDestroyed()) return;
      if (layer.current) v.imageryLayers.remove(layer.current);
      layer.current = v.imageryLayers.addImageryProvider(p);
    });
    pt.current.position = Cartesian3.fromDegrees(lon, lat, 0);
    // regional context (~2,500 km altitude): the bundled Natural Earth base is ~1 km/px, so zooming to the 600 m chip only shows a flat blur
    v.camera.flyTo({ destination: Cartesian3.fromDegrees((w + e) / 2, (s + n) / 2, 2.5e6), duration: reduced() ? 0 : 2.4, easingFunction: EasingFunction.CUBIC_IN_OUT });
    return () => { gone = true; };
  }, [bbox.join(","), imgUrl]); // eslint-disable-line
  return <div className="sitegl" ref={box} aria-label="Globe showing the evidence site" />;
}
