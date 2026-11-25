import type { Viewer } from "cesium";
import { naturalLayer } from "./cz";

export interface Diag { ua: string; gl: string; error: string; imagery: string; tiles: string; safe: boolean }
/** WebGL version and renderer of this browser, for the diagnostic panel */
export function glInfo(): string {
  try {
    const c = document.createElement("canvas"), g2 = c.getContext("webgl2"), g = (g2 ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!g) return "no WebGL context";
    const x = g.getExtension("WEBGL_debug_renderer_info");
    return `${g2 ? "WebGL2" : "WebGL1"} | ${x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)}`;
  } catch (e) { return `WebGL probe threw: ${String(e)}`; }
}
export const diagOf = (error: string, imagery: string, tiles: string, safe: boolean): Diag => {
  const d = { ua: navigator.userAgent, gl: glInfo(), error: error.split("\n")[0].slice(0, 240), imagery, tiles, safe };
  console.error("[HERALD globe]", JSON.stringify(d), error); return d;
};
/** Watchdog for a Cesium viewer: render errors, imagery errors, 10 s imagery fallback to Natural Earth, 15 s not-ready failure. Returns a disposer. */
export function guard(v: Viewer, o: { shown: () => boolean; safe: boolean; onReady: () => void; onFail: (d: Diag) => void }): () => void {
  v.scene.rethrowRenderErrors = false;
  let done = false, imagery = "loading", tiles = "-", fell = false, waited = 0;
  const day = v.imageryLayers.get(0);
  const fail = (err: string) => { if (done) return; done = true; o.onFail(diagOf(err, imagery, tiles, o.safe)); };
  const fallback = (why: string) => {
    if (fell || v.isDestroyed()) return; fell = true; imagery = `local texture failed (${why}); using bundled Natural Earth II`;
    console.error("[HERALD globe] imagery fallback:", why); v.imageryLayers.remove(day, false); v.imageryLayers.add(naturalLayer(), 0); v.scene.requestRender();
  };
  day.errorEvent.addEventListener((e: any) => fallback(String(e?.message ?? e)));
  day.readyEvent.addEventListener(() => { if (!fell) imagery = "local texture ready"; });
  v.scene.renderError.addEventListener((_s: unknown, e: unknown) => fail(`render error: ${String((e as Error)?.message ?? e)}`));
  v.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => { tiles = String(n); if (n === 0 && !done && (fell || day.ready)) { done = true; o.onReady(); } });
  const tick = setInterval(() => {
    if (done || v.isDestroyed()) return clearInterval(tick);
    if (!o.shown()) { waited = 0; return; }
    waited += 1;
    if (waited === 10 && !day.ready && !fell) fallback("not ready in 10 s");
    if (waited >= 15) { clearInterval(tick); fail("globe not ready in 15 s"); }
  }, 1000);
  return () => { done = true; clearInterval(tick); };
}

export function GlobeDiag({ d, onRetry }: { d: Diag; onRetry?: () => void }) {
  return (
    <div className="gdiag" role="alert">
      <b>3D globe unavailable, showing the 2D view</b>
      <dl className="mono">
        <dt>error</dt><dd>{d.error}</dd><dt>imagery</dt><dd>{d.imagery}</dd><dt>tiles pending</dt><dd>{d.tiles}</dd>
        <dt>webgl</dt><dd>{d.gl}</dd><dt>browser</dt><dd>{d.ua}</dd>
      </dl>
      {onRetry && <button onClick={onRetry}>Retry 3D</button>}
    </div>
  );
}
