import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Skeleton, Guard } from "./ui";
import { loadData, type Data } from "./data";
import { useSched } from "./useSched";
import type { Query } from "./types";
import { Overview } from "./views/Overview";
import { Fifo } from "./views/Fifo";
import { Insights } from "./views/Insights";
import { Siting } from "./views/Siting";
import { Planner } from "./views/Planner";
import { Evidence } from "./views/Evidence";
import { Economics, Hardware, About } from "./views/Static";

import { Tabs, Empty } from "./kit";
const DeepC = lazy(() => import.meta.glob("./deep/TrackC.tsx")["./deep/TrackC.tsx"]?.() as Promise<any> ?? Promise.resolve({ default: () => <Empty title="Deep dive not installed">web/src/deep/TrackC.tsx is not present in this build.</Empty> }));
const Mission = lazy(() => import("./views/Mission"));
const Lab = lazy(() => import.meta.glob("./lab/Lab.tsx")["./lab/Lab.tsx"]?.() as Promise<any> ?? Promise.resolve({ default: () => <Empty title="AI Lab">web/src/lab/Lab.tsx is not present in this build.</Empty> }));
const Simulation = lazy(() => import("./views/Simulation"));

interface V { id: string; label: string; group: string; track?: string; title: string }
const VIEWS: V[] = [
  { id: "command", label: "Command center", group: "", title: "Command center" },
  { id: "overview", label: "Story", group: "", title: "Story" },
  { id: "ledger", label: "Construction ledger", group: "Track A: Read the planet", track: "A", title: "Construction ledger" },
  { id: "siting", label: "Renewable siting", group: "Track A: Read the planet", track: "A", title: "Renewable siting" },
  { id: "fifo", label: "Downlink: FIFO vs HERALD", group: "Track B: Build the orbit", track: "B", title: "Downlink: FIFO vs HERALD" },
  { id: "queries", label: "Downlink planner", group: "Track B: Build the orbit", track: "B", title: "Downlink planner" },
  { id: "evidence", label: "Evidence", group: "Track C: Guard the nation", track: "C", title: "Evidence chain" },
  { id: "simulation", label: "Simulation", group: "Simulation", title: "Simulation" },
  { id: "lab", label: "AI Lab", group: "AI Lab", title: "AI Lab" },
  { id: "model", label: "Model and hardware", group: "System", title: "Model and hardware" },
  { id: "econ", label: "Economics", group: "System", title: "Economics" },
  { id: "gates", label: "Gates and limits", group: "System", title: "Gates and limits" },
];
const GROUPS = ["", "Track A: Read the planet", "Track B: Build the orbit", "Track C: Guard the nation", "Simulation", "AI Lab", "System"];
const GROUP_NOTE: Record<string, string> = {};
const hashId = () => { const h = location.hash.replace(/^#\/?/, ""); return h === "mission" ? "command" : h; };
const fromHash = () => Math.max(0, VIEWS.findIndex((v) => v.id === hashId()));

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadData().then(setData, (e) => setErr(String(e.message ?? e))); }, []);
  if (err) return <div className="boot bad">{err}</div>;
  if (!data) return <div className="shell"><div className="col"><main><Skeleton rows={6} label="loading data" /></main></div></div>;
  return <Shell data={data} />;
}

function Shell({ data }: { data: Data }) {
  const [i, setI] = useState(fromHash);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("herald.side") === "0");
  const [seen0, setSeen0] = useState(VIEWS[i].id === "command"), [seenS, setSeenS] = useState(VIEWS[i].id === "simulation"); // Mission stays mounted once opened: one Cesium viewer, paused while hidden
  const cur = VIEWS[i], isMission = cur.id === "command";
  useEffect(() => { if (isMission) setSeen0(true); }, [isMission]);
  const isSim = cur.id === "simulation";
  useEffect(() => { if (isSim) setSeenS(true); }, [isSim]);
  useEffect(() => { const h = () => setI(fromHash()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  const go = useCallback((id: string) => { location.hash = `/${id}`; mainRef.current?.scrollTo(0, 0); }, []);
  const mainRef = useRef<HTMLElement>(null), navRef = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem("herald.side", collapsed ? "0" : "1"); }, [collapsed]);
  useEffect(() => { document.title = `${cur.title} | HERALD`; }, [cur]);
  const [queries, setQueries] = useState<Query[]>(data.queries);
  const [rho, setRho] = useState(5);
  const { out, ms, runs } = useSched(data.tiles, data.wins, data.params, queries, rho);
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "Home" ? -99 : e.key === "End" ? 99 : 0;
    if (!d) return;
    e.preventDefault();
    const n = Math.max(0, Math.min(VIEWS.length - 1, Math.abs(d) > 1 ? (d < 0 ? 0 : VIEWS.length - 1) : i + d));
    go(VIEWS[n].id);
    (navRef.current?.querySelectorAll("a")[n] as HTMLElement | undefined)?.focus();
  };
  const common = { data, out, queries, rho };
  const date = (data.reports.survey_blr?.dates?.[1] ?? "").slice(0, 10);
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <a className="skip" href="#panel">Skip to content</a>
      <aside className="side" aria-label="Primary">
        <div className="logo"><b>HERALD</b></div>
        <div className="navs" ref={navRef} onKeyDown={onKey}>
          {GROUPS.map((g) => (
            <div className="grp" key={g || "top"} role="group" aria-label={g || "Overview"}>
              {g && g !== "Simulation" && g !== "AI Lab" && <span className={`gtl t${g[6]}`}><b>{g.split(": ")[0]}</b>{g.includes(": ") ? <small>{g.split(": ")[1]}</small> : null}</span>}
              {VIEWS.map((v, k) => v.group === g && (
                <a key={v.id} href={`#/${v.id}`} className={k === i ? "on" : ""} aria-current={k === i ? "page" : undefined} title={v.label}
                  onClick={(e) => { e.preventDefault(); go(v.id); }}>
                  <i className={`mk ${v.track ? "t" + v.track : ""}`}>{v.track ?? (v.id === "command" ? "C" : v.id === "overview" ? "O" : "S")}</i><span>{v.label}</span></a>))}
            </div>))}
        </div>
        <button className="collapse" onClick={() => setCollapsed(!collapsed)} aria-pressed={collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? "»" : "« Collapse"}</button>
      </aside>
      <div className="col">
        <header className="topbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>HERALD</span>{cur.group && <><i>/</i><span>{cur.group}</span></>}<i>/</i><b aria-current="page">{cur.title}</b>
          </nav>
          <span className="tagline" />
          <div className="flags">
            {data.synthetic && <span className="badge warn">synthetic orbit data</span>}
            {data.sample.length > 0 && <span className="badge warn" title={data.sample.join(", ")}>sample data: {data.sample.join(", ")}</span>}
            {date && <span className="badge" title="Date of the latest Sentinel-2 scene in the Bengaluru pair">Data as of {date}</span>}
            <span className="badge ok" title="Every file is served from this origin; no network requests are made after load">Offline, 0 external requests</span>
          </div>
        </header>
        <main id="panel" ref={mainRef} tabIndex={-1}>
          <Suspense fallback={<Skeleton rows={5} label="loading globe" />}>
            {seen0 && <div className="view" style={isMission ? undefined : { display: "none" }}><Guard label="Command center globe"><Mission {...common} active={isMission} /></Guard></div>}
            {seenS && <div className="view" style={isSim ? undefined : { display: "none" }}><Guard label="Simulation globe"><Simulation {...common} active={isSim} /></Guard></div>}
            {!isMission && !isSim && <div className="view" key={cur.id}>
              {cur.id === "overview" && <Guard label="Overview"><Overview {...common} go={go} /></Guard>}
              {cur.id === "ledger" && <Guard label="Construction ledger"><Insights {...common} /></Guard>}
              {cur.id === "siting" && <Guard label="Siting"><Siting {...common} /></Guard>}
              {cur.id === "fifo" && <Guard label="FIFO vs HERALD"><Fifo {...common} setRho={setRho} /></Guard>}
              {cur.id === "queries" && <Guard label="Planner"><Planner {...common} setQueries={setQueries} ms={ms} /></Guard>}
              {cur.id === "evidence" && <Guard label="Evidence"><Tabs tabs={[{ id: "cases", label: "Cases", node: () => <Evidence {...common} /> }, { id: "deep", label: "Deep dive", node: () => <Guard label="Track C deep dive"><Suspense fallback={<Skeleton rows={4} />}><DeepC {...common} /></Suspense></Guard> }]} /></Guard>}
              {cur.id === "lab" && <Guard label="AI Lab"><Suspense fallback={<Skeleton rows={4} />}><Lab {...common} /></Suspense></Guard>}
              {cur.id === "model" && <Guard label="Model and hardware"><Hardware data={data} /></Guard>}
              {cur.id === "econ" && <Guard label="Economics"><Economics data={data} /></Guard>}
              {cur.id === "gates" && <Guard label="Gates"><About data={data} ms={ms} runs={runs} /></Guard>}
            </div>}
          </Suspense>
        </main>
        <footer className="attr">Contains modified Copernicus Sentinel data 2023-2026 · © OpenStreetMap contributors (ODbL) · ESA WorldCover · JRC Global Surface Water · NASA POWER · Copernicus DEM · Earth textures: Solar System Scope (CC BY 4.0), from NASA data</footer>
      </div>
    </div>
  );
}
