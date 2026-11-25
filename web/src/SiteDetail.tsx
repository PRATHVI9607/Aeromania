import { useEffect, useMemo, useRef, useState } from "react";
import { BeforeAfter } from "./ui";
import { Info } from "./kit";
import { useJson } from "./useJson";
import { aoiGeo } from "./geo";
import type { Data } from "./data";

export interface Fact { k: string; v: React.ReactNode; why?: React.ReactNode }
export interface SiteRef { actions?: React.ReactNode; id: string; aoi: string; lat: number; lon: number; title: string; facts: Fact[]; onFlyTo?: () => void; fallback?: string[] }
const STAGES = ["t0", "c1", "t1", "c2"] as const;
const PX = 192, M_PER_PX = 10;

/** Frames for one site from sites_index.json: files{} keyed t0/c1/t1/c2/mask, dates{} and cloud{} keyed by stage. */
function frames(entry: any) {
  if (!entry) return { list: [] as { key: string; label: string; url: string; cloud: number | null }[], mask: null as string | null };
  const files: Record<string, string> = entry.files ?? {}, dates: Record<string, string> = entry.dates ?? {}, cloud: Record<string, number> = entry.cloud ?? {};
  const url = (f: string) => (f.startsWith("/") ? f : `/data/${f.replace(/^data\//, "")}`);
  const list = STAGES.filter((k) => files[k]).map((k) => ({ key: k, label: dates[k] ?? k, url: url(files[k]), cloud: typeof cloud[dates[k]] === "number" ? cloud[dates[k]] : typeof cloud[k] === "number" ? cloud[k] : null }));
  return { list, mask: files.mask ? url(files.mask) : null };
}

export function SiteDrawer({ site, data, onClose }: { site: SiteRef; data: Data; onClose: () => void }) {
  const idx = useJson<Record<string, any>>("sites_index.json");
  const entry = useMemo(() => idx?.[site.id], [idx, site.id]);
  const { list, mask } = useMemo(() => frames(entry), [entry]);
  const [sel, setSel] = useState(0), [cmp, setCmp] = useState(false), [showMask, setShowMask] = useState(false), [maskOk, setMaskOk] = useState(true);
  const [w, setW] = useState(576);
  const body = useRef<HTMLDivElement>(null), closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { setSel(Math.max(0, list.findIndex((x) => x.key === "t1"))); setCmp(false); setShowMask(false); setMaskOk(true); }, [site.id, list.length]);
  useEffect(() => { closeBtn.current?.focus(); const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  useEffect(() => { const el = body.current; if (!el) return; const f = () => setW(Math.max(PX, Math.floor((el.clientWidth - 2) / PX) * PX)); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, []);
  const scale = Math.max(1, w / PX), size = PX * scale;
  const geo = useMemo(() => aoiGeo(data.tiles, site.aoi), [data.tiles, site.aoi]);
  const fx = geo?.(site.lat, site.lon);
  const px = (u: string): React.CSSProperties => ({ backgroundImage: `url(${u})`, backgroundSize: `${size}px ${size}px`, backgroundPosition: "0 0", imageRendering: "pixelated" });
  const bar = Math.round(500 / M_PER_PX * scale); // 500 m
  const cur = list[sel], last = list.find((x) => x.key === "t1") ?? list[list.length - 1];
  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-label={`Location detail: ${site.title}`}>
      <header className="dhead">
        <div><span className="dim mono small">{site.id}</span><h3>{site.title}</h3></div>
        <button ref={closeBtn} className="x" onClick={onClose} aria-label="Close detail (Escape)">Close <kbd>Esc</kbd></button>
      </header>
      <div className="dbody" ref={body}>
        {site.actions}
        {list.length === 0 ? (
          <div className="noimg">
            {idx === undefined ? <span>Loading native-resolution crops</span> : <span>Native-resolution crops for this site are not in sites_index.json. The locator below shows where it is.</span>}
          </div>
        ) : (<>
          <div className="viewer" style={{ width: size, height: size }}>
            {cmp && list.length > 1 ? <BeforeAfter before={px(list[0].url)} after={px(last.url)} size={size} labels={[list[0].label, last.label]} />
              : cur && <div className="px" style={px(cur.url)} role="img" aria-label={`Sentinel-2 ${cur.label}, native 10 m resolution`} />}
            {showMask && maskOk && mask && <img className="maskov" src={mask} alt="Detected change mask" width={size} height={size} style={{ imageRendering: "pixelated" }} onError={() => setMaskOk(false)} />}
            <svg className="north" viewBox="0 0 24 32" aria-label="North is up"><path d="M12 2 20 26 12 20 4 26Z" /><text x="12" y="31" textAnchor="middle">N</text></svg>
            <div className="sbar" style={{ width: bar }}><i /><span>500 m</span></div>
          </div>
          <div className="film" role="tablist" aria-label="Acquisition dates">
            {list.map((f, i) => (
              <button key={f.key} role="tab" aria-selected={!cmp && sel === i} className={!cmp && sel === i ? "on" : ""} onClick={() => { setSel(i); setCmp(false); }}>
                <div className="th" style={{ backgroundImage: `url(${f.url})`, imageRendering: "pixelated" }} /><span className="mono">{f.key}</span><small>{f.label}</small><small className={f.cloud != null && f.cloud > 0.2 ? "bad" : "dim"}>{f.cloud != null ? `${(f.cloud * 100).toFixed(0)}% cloud` : ""}</small></button>))}
          </div>
          <div className="tools">
            <label><input type="checkbox" checked={cmp} disabled={list.length < 2} onChange={(e) => setCmp(e.target.checked)} /> Before / after swipe (t0 to t1)</label>
            <label><input type="checkbox" checked={showMask} disabled={!maskOk} onChange={(e) => setShowMask(e.target.checked)} /> Change mask {!maskOk && <span className="dim">(not available)</span>}</label>
          </div>
          <p className="muted small">Native Sentinel-2 pixels, shown {scale}x with no smoothing: one square is {M_PER_PX} m by {M_PER_PX} m. The crop is {PX} px = {(PX * M_PER_PX / 1000).toFixed(2)} km across. Stage names: t0 first date, c1 and c2 intermediate dates where a clear scene exists, t1 latest.</p>
        </>)}

        <h4 className="dh">Where it is <Info title="Locator">The AOI mosaic at t1 (Sentinel-2, 46 by 46 tiles of 320 m). The marker is placed from tile-centre extremes, so it can be off by a few tens of metres.</Info></h4>
        <div className="locator">
          <img src={`/data/img/${site.aoi}_t1.jpg`} alt={`${site.aoi} mosaic`} width={320} height={320} decoding="async" />
          {fx && <svg viewBox="0 0 100 100" preserveAspectRatio="none"><circle cx={fx[0] * 100} cy={fx[1] * 100} r={3.2} /><circle className="o" cx={fx[0] * 100} cy={fx[1] * 100} r={6} /></svg>}
          <div className="loctxt"><span className="mono">{site.lat.toFixed(5)}, {site.lon.toFixed(5)}</span>
            {site.onFlyTo && <button onClick={site.onFlyTo}>Fly the Mission globe here</button>}</div>
        </div>

        <h4 className="dh">Numbers and what they mean</h4>
        <dl className="facts">{site.facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}{f.why && <Info title={f.k}>{f.why}</Info>}</dd></div>)}</dl>
        {site.fallback?.map((t, i) => <p className="muted small" key={i}>{t}</p>)}
      </div>
    </aside>
  );
}
