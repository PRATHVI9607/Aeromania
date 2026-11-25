import { buildModuleUrl, TileMapServiceImageryProvider, Cartesian3, Color, Ion, ImageryLayer, PointPrimitiveCollection, Rectangle, SingleTileImageryProvider, SkyAtmosphere, Viewer } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

Ion.defaultAccessToken = "";
/** Local Earth textures (Solar System Scope, CC BY 4.0, from NASA data), one tile over the whole globe. */
const whole = (url: string) => ImageryLayer.fromProviderAsync(SingleTileImageryProvider.fromUrl(url, { rectangle: Rectangle.MAX_VALUE }));
export const dayLayer = () => whole("/earth/earth_day_4096.jpg");
/** Offline viewer: local day texture (or a given base layer), no ion, no widgets, render on demand. */
export function makeViewer(el: HTMLElement, baseLayer?: ImageryLayer | false): Viewer {
  const v = new Viewer(el, {
    baseLayer: baseLayer === undefined ? dayLayer() : baseLayer,
    geocoder: false, baseLayerPicker: false, animation: false, timeline: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true, msaaSamples: 1, showRenderLoopErrors: false,
    maximumRenderTimeChange: Infinity, shouldAnimate: false, skyBox: false, skyAtmosphere: false, creditContainer: document.createElement("div"),
  });
  v.useBrowserRecommendedResolution = false; v.resolutionScale = Math.min(window.devicePixelRatio || 1, 2); v.scene.postProcessStages.fxaa.enabled = true;
  v.scene.globe.showWaterEffect = false;
  v.scene.backgroundColor = Color.fromCssColorString("#0A0E14");
  v.scene.globe.baseColor = Color.fromCssColorString("#10151c");
  return v;
}

/** Bundled Natural Earth II tiles (copied by vite.config.ts): the fallback when the local textures fail. */
export const naturalLayer = () => ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII")));
/** Lit Earth: day texture, city lights on the dark side, sky and ground atmosphere, star field. Shared by Command center and Simulation.
 *  safe = plain day texture only (no lighting, atmosphere, FXAA): the retry when the full shader set fails on a GPU. */
export function makeEarth(el: HTMLElement, safe = false): Viewer {
  const v = makeViewer(el);
  if (safe) { v.scene.postProcessStages.fxaa.enabled = false; return v; }
  const day = v.imageryLayers.get(0); day.nightAlpha = 0;
  const night = whole("/earth/earth_night_4096.jpg"); v.imageryLayers.add(night); night.dayAlpha = 0; night.nightAlpha = 1; night.brightness = 1.7;
  // requestRenderMode: draw again once each texture arrives, otherwise the lights/day layer can stay invisible until the camera moves
  for (const l of [day, night]) l.readyEvent.addEventListener(() => { if (!v.isDestroyed()) v.scene.requestRender(); });
  const g = v.scene.globe; g.enableLighting = true; g.showGroundAtmosphere = true; g.dynamicAtmosphereLighting = true; g.dynamicAtmosphereLightingFromSun = false;
  const sky = new SkyAtmosphere(); sky.brightnessShift = -0.1; v.scene.skyAtmosphere = sky;
  const stars = v.scene.primitives.add(new PointPrimitiveCollection());
  for (let i = 0; i < 900; i++) { const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, r = Math.sqrt(1 - u * u); stars.add({ position: new Cartesian3(r * Math.cos(a) * 3e8, r * Math.sin(a) * 3e8, u * 3e8), pixelSize: 1 + Math.random() * 1.2, color: Color.WHITE.withAlpha(0.25 + Math.random() * 0.6) }); }
  v.scene.requestRender();
  return v;
}
