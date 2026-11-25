import { useEffect, useMemo, useRef, useState } from "react";
import { Cartesian3, Color, EasingFunction, ImageryLayer, JulianDate, Rectangle, SingleTileImageryProvider, Viewer } from "cesium";
import type { ViewProps } from "./props";
import { makeEarth } from "../cz";
import { BarChart } from "../charts";
import { reduced } from "../anim";
import { guard, diagOf, GlobeDiag, type Diag } from "../globeHealth";
import "./command.css";
import "./simulation.css";

const N = 46;
const SCEN = [
  { id: "blr", label: "Bengaluru A", sub: "Lakes and construction" },
  { id: "hasdeo", label: "Hasdeo C", sub: "Coal mine expansion" },
  { id: "sone", label: "Sone C", sub: "River sand pits" },
] as const;
const KEYS = ["t0", "c1", "t1", "c2"] as const;
const TAG: Record<string, string> = { t0: "baseline", t1: "after", c1: "cloudy pass", c2: "cloudy pass" };
const lakeName = (s: any, i: number) => (/^unnamed/.test(s.lake ?? "") ? `Lake ${i + 1}` : String(s.lake).replace(/ Lake$/, ""));

/** Mosaic corners from the 46 x 46 tile grid (tile centres, extended by half a tile). */
function bounds(tiles: ViewProps["data"]["tiles"], aoi: string): [number, number, number, number] | null {
  const t = tiles.filter((x) => x.aoi === aoi && x.date === "t1"); if (t.length < N * N) return null;
  const a = t[0], b = t[N * N - 1], dx = (b.lon - a.lon) / (N - 1) / 2, dy = (b.lat - a.lat) / (N - 1) / 2;
  return [Math.min(a.lon - dx, b.lon + dx), Math.min(a.lat - dy, b.lat + dy), Math.max(a.lon - dx, b.lon + dx), Math.max(a.lat - dy, b.lat + dy)];
}

export default function Simulation({ data, active: shown }: ViewProps & { active: boolean }) {
  const box = useRef<HTMLDivElement>(null), vr = useRef<Viewer | null>(null);
  const lay = useRef<{ key: string; layer: ImageryLayer }[]>([]), chg = useRef<ImageryLayer | null>(null), alphas = useRef<number[]>([]);
  const [aoi, setAoi] = useState<string>("blr"), [i, setI] = useState(0), [play, setPlay] = useState(false), [overlay, setOverlay] = useState(false);
  const [mode, setMode] = useState<"3d" | "2d">("3d"), [safe, setSafe] = useState(false), [diag, setDiag] = useState<Diag | null>(null);
  const failRef = useRef<(d: Diag) => void>(() => {}), shownRef = useRef(shown); shownRef.current = shown;
  failRef.current = (d) => { if (!safe) setSafe(true); else { setDiag(d); setMode("2d"); } };
  const R = data.reports;
  const scenes = useMemo(() => {
    const sc = R.vault?.aois?.[aoi]?.scenes ?? {};
    return KEYS.filter((k) => sc[k]).map((k) => ({ key: k, date: sc[k].date as string, cloud: sc[k].aoi_cloud_pct as number })).sort((a, b) => a.date.localeCompare(b.date));
  }, [R.vault, aoi]);
  const b = useMemo(() => bounds(data.tiles, aoi), [data.tiles, aoi]);
  const cur = scenes[Math.min(i, scenes.length - 1)];

  useEffect(() => {
    if (mode !== "3d") return;
    let v: Viewer;
    try { v = makeEarth(box.current!, safe); } catch (e) { failRef.current(diagOf(`viewer constructor threw: ${String(e)}`, "-", "-", safe)); return; }
    vr.current = v;
    v.camera.setView({ destination: Cartesian3.fromDegrees(80, 20, reduced() ? 1.2e7 : 2.6e7) });
    (window as any).__herald = { ...(window as any).__herald, globeReady: false, layers: {}, mode: "3d", safe };
    const stop = guard(v, { safe, shown: () => shownRef.current, onReady: () => { (window as any).__herald = { ...(window as any).__herald, globeReady: true }; }, onFail: (d) => failRef.current(d) });
    return () => { stop(); v.camera.cancelFlight(); v.useDefaultRenderLoop = false; v.destroy(); vr.current = null; };
  }, [mode, safe]);
  useEffect(() => { const v = vr.current; if (v && !v.isDestroyed()) { v.useDefaultRenderLoop = shown; if (shown) v.scene.requestRender(); } }, [shown]);

  // scenario: one draped single-tile layer per acquisition (alpha 0 until selected), plus the change overlay
  useEffect(() => {
    const v = vr.current; if (!v || v.isDestroyed() || !b) return;
    const rectangle = Rectangle.fromDegrees(...b);
    const mk = (url: string, alpha: number) => { const l = ImageryLayer.fromProviderAsync(SingleTileImageryProvider.fromUrl(url, { rectangle }), { alpha }); v.imageryLayers.add(l); return l; };
    lay.current = scenes.map((s) => ({ key: s.key, layer: mk(`/data/img/${aoi}_${s.key}.jpg`, 0) }));
    alphas.current = scenes.map(() => 0);
    chg.current = mk(`/data/img/${aoi}_change.png`, 0.85); chg.current.show = false;
    const pad = 0;
    v.camera.flyTo({ destination: Rectangle.fromDegrees(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad), duration: reduced() ? 0 : 2.2, easingFunction: EasingFunction.CUBIC_IN_OUT });
    setI(0); setPlay(false); setOverlay(false);
    return () => { if (!v.isDestroyed()) { lay.current.forEach((x) => v.imageryLayers.remove(x.layer)); if (chg.current) v.imageryLayers.remove(chg.current); } lay.current = []; chg.current = null; };
  }, [aoi, b, scenes, mode, safe]);

  // date: crossfade to the chosen layer, light the scene at 10:30 local solar time on that date
  useEffect(() => {
    const v = vr.current; if (!v || v.isDestroyed() || !cur || !b) return;
    const from = [...alphas.current], t0 = performance.now(), ms = reduced() ? 1 : 900;
    let raf = 0;
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / ms);
      lay.current.forEach((x, k) => { const to = scenes[k].key === cur.key ? 1 : 0; alphas.current[k] = (from[k] ?? 0) + (to - (from[k] ?? 0)) * f; x.layer.alpha = alphas.current[k]; });
      v.scene.requestRender(); if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const lonc = (b[0] + b[2]) / 2, utc = new Date(`${cur.date}T00:00:00Z`).getTime() + (10.5 - lonc / 15) * 3600e3;
    v.clock.currentTime = JulianDate.fromDate(new Date(utc));
    return () => cancelAnimationFrame(raf);
  }, [cur?.key, scenes, b, aoi, mode, safe]);
  useEffect(() => { if (cur) (window as any).__herald = { ...(window as any).__herald, sim: { aoi, date: cur.date, imagery: `/data/img/${aoi}_${cur.key}.jpg` } }; }, [cur?.key, aoi]);
  useEffect(() => { const v = vr.current; if (chg.current) { chg.current.show = overlay; v?.scene.requestRender(); } }, [overlay, aoi]);
  useEffect(() => {
    if (!play) return; const h = setInterval(() => setI((k) => (k + 1) % scenes.length), 2600); return () => clearInterval(h);
  }, [play, scenes.length]);

  const sites: any[] = R.sites_blr?.sites ?? [], cards: any[] = R.evidence?.cards ?? [];
  const lakes = sites.filter((s) => s.category === "lake_filling_lead");
  const cats = R.sites_blr?.category_counts ?? {};
  const CATN: Record<string, string> = { new_layout: "New layout", building_construction: "Building", agri_ambiguous: "Cleared, ambiguous", lake_filling_lead: "Lake lead" };
  const isBlr = aoi === "blr";
  const cs = cards.filter((c) => c.aoi === aoi);
  return (
    <div className="missionwrap cmd sim">
      <div className="cmdtop">
        <h1>Simulation</h1>
        <div className="seg" role="tablist" aria-label="Scenario">
          {SCEN.map((s) => <button key={s.id} role="tab" aria-selected={aoi === s.id} className={aoi === s.id ? "on" : ""} onClick={() => setAoi(s.id)} title={s.sub}>{s.label}</button>)}
        </div>
        <span className="chip">{SCEN.find((s) => s.id === aoi)?.sub}</span>
        <span className="grow" />
        <div className="seg vmode" role="group" aria-label="View mode"><button className={mode === "3d" ? "on" : ""} onClick={() => { setDiag(null); setSafe(false); setMode("3d"); }}>3D</button><button className={mode === "2d" ? "on" : ""} onClick={() => setMode("2d")}>2D</button></div>
        <span className="chip ok" title="Sentinel-2 L2A scenes served from this origin">Real Sentinel-2 imagery replayed; dates are real acquisitions</span>
      </div>
      <div className="simgrid">
        <div className="globe">
          {mode === "3d" ? <div className="gl" ref={box} aria-label="Globe with Sentinel-2 imagery draped over the study area" /> : (
            <div className="simflat" aria-label="Sentinel-2 imagery of the study area">
              {scenes.map((x, k) => <img key={aoi + x.key} className="sf" style={{ opacity: k === Math.min(i, scenes.length - 1) ? 1 : 0 }} src={`/data/img/${aoi}_${x.key}.jpg`} alt="" />)}
              <img className="sf" style={{ opacity: overlay ? 0.85 : 0 }} src={`/data/img/${aoi}_change.png`} alt="" />
            </div>)}
          {diag && <GlobeDiag d={diag} onRetry={() => { setDiag(null); setSafe(false); setMode("3d"); }} />}
          {cur && <div className="hud"><b data-sim-date>{cur.date}</b><span className="chip">{TAG[cur.key]}</span><span className="mono dim">cloud {cur.cloud.toFixed(0)}%</span></div>}
        </div>
        <aside className="panel charts">
          {isBlr ? (<>
            <h3>Lake water area, ha <small>t0 vs t1</small></h3>
            <BarChart unit=" ha" series={[{ name: "Feb 2023", color: "#22D3EE" }, { name: "Feb 2025", color: "#F5A524" }]}
              rows={lakes.map((s, k) => ({ key: String(s.osm_id), label: lakeName(s, k), vals: [s.water_t0_ha ?? 0, s.water_t1_ha ?? 0],
                note: `lost to vegetation ${s.lost_to_veg_ha} ha, bare ${s.lost_to_bare_ha} ha, built ${s.lost_to_built_ha} ha` }))} />
            <h3>New construction, ha <small>by category</small></h3>
            <BarChart unit=" ha" series={[{ name: "ha", color: "#F5A524" }]} rows={Object.entries(cats).map(([k, v]: [string, any]) => ({ key: k, label: CATN[k] ?? k, vals: [v.ha], note: `${v.n} sites` }))} />
          </>) : (<>
            <h3>{aoi === "hasdeo" ? "Changed area per evidence case" : "Sand pits"} <small>ha</small></h3>
            <BarChart unit=" ha" series={[{ name: "ha", color: "#34D399" }]}
              rows={cs.sort((a, b) => b.ha - a.ha).map((c) => ({ key: c.card_id, label: c.card_id, vals: [c.ha], note: `${String(c.kind).replace(/_/g, " ")}, audit ${c.audit_label}${c.n_pits ? `, ${c.n_pits} pits` : ""}` }))} />
          </>)}
        </aside>
      </div>
      <div className="cbar">
        <button className="primary" onClick={() => setPlay(!play)} aria-pressed={play}>{play ? "Pause" : "Play"}</button>
        <div className="mono ck" style={{ minWidth: 104 }}>{cur?.date}</div>
        <div className="scrub dates">
          <input type="range" data-sim="date" min={0} max={Math.max(0, scenes.length - 1)} step={1} value={Math.min(i, scenes.length - 1)} onChange={(e) => setI(+e.target.value)} aria-label="Acquisition date" />
          <div className="dlab">{scenes.map((s, k) => <button key={s.key} className={k === i ? "on" : ""} style={{ left: `${scenes.length > 1 ? (k / (scenes.length - 1)) * 100 : 0}%` }} onClick={() => setI(k)}>{s.date.slice(0, 7)}</button>)}</div>
        </div>
        <label className="lyr"><input type="checkbox" checked={overlay} onChange={() => setOverlay(!overlay)} /><span>Change overlay</span></label>
      </div>
    </div>
  );
}
