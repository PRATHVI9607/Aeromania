import { Color, Ion, ImageryLayer, TileMapServiceImageryProvider, Viewer, buildModuleUrl } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

Ion.defaultAccessToken = "";
/** Offline viewer: bundled Natural Earth II (or a given base layer), no ion, no widgets, render on demand. */
export function makeViewer(el: HTMLElement, baseLayer?: ImageryLayer | false): Viewer {
  const v = new Viewer(el, {
    baseLayer: baseLayer === undefined ? ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"))) : baseLayer,
    geocoder: false, baseLayerPicker: false, animation: false, timeline: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, requestRenderMode: true,
    maximumRenderTimeChange: Infinity, shouldAnimate: false, skyBox: false, skyAtmosphere: false, creditContainer: document.createElement("div"),
  });
  v.useBrowserRecommendedResolution = false; v.resolutionScale = Math.min(window.devicePixelRatio || 1, 2); v.scene.postProcessStages.fxaa.enabled = true;
  v.scene.globe.showWaterEffect = false;
  v.scene.backgroundColor = Color.fromCssColorString("#0A0E14");
  v.scene.globe.baseColor = Color.fromCssColorString("#10151c");
  return v;
}
