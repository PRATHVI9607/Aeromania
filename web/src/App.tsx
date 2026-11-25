import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "./ui";
import { loadData, type Data } from "./data";
import { useSched } from "./useSched";
import type { Query } from "./types";
import { Fifo } from "./views/Fifo";
import { Insights } from "./views/Insights";
import { Siting } from "./views/Siting";
import { QueriesView } from "./views/Queries";
import { Evidence } from "./views/Evidence";
import { Economics, Hardware, About } from "./views/Static";

const Mission = lazy(() => import("./views/Mission"));
const TABS = ["Mission", "FIFO vs HERALD", "Insights", "Siting", "Queries", "Evidence", "Economics", "Hardware", "About / Limits"] as const;

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadData().then(setData, (e) => setErr(String(e.message ?? e))); }, []);
  if (err) return <div className="boot bad">{err}</div>;
  if (!data) return <div className="app"><header className="top"><div className="brand">HERALD</div></header><main><Skeleton rows={6} label="loading data" /></main></div>;
  return <Shell data={data} />;
}

function Shell({ data }: { data: Data }) {
  const [tab, setTab] = useState(0);
  const [seen0, setSeen0] = useState(true); // Mission stays mounted once opened: one Cesium viewer, paused while hidden
  useEffect(() => { if (tab === 0) setSeen0(true); }, [tab]);
  const [queries, setQueries] = useState<Query[]>(data.queries);
  const [rho, setRho] = useState(5);
  const { out, ms, runs } = useSched(data.tiles, data.wins, data.params, queries, rho);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const n = (tab + d + TABS.length) % TABS.length;
    setTab(n); refs.current[n]?.focus();
  };
  const [ind, setInd] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => { const b = refs.current[tab]; if (b) setInd({ x: b.offsetLeft, w: b.offsetWidth }); }, [tab]);
  const common = { data, out, queries, rho };
  return (
    <div className="app">
      <header className="top">
        <div className="brand">HERALD<span>{"\u2014"} the satellite that sends home answers, not pictures.</span></div>
        <div className="flags">
          {data.synthetic && <span className="badge warn">synthetic orbit data</span>}
          {data.sample.length > 0 && <span className="badge warn" title={data.sample.join(", ")}>sample data: {data.sample.join(", ")}</span>}
        </div>
      </header>
      <nav role="tablist" aria-label="Views" onKeyDown={onKey}>
        {TABS.map((t, i) => (
          <button key={t} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${i}`} aria-selected={tab === i}
            aria-controls="panel" tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)}>{t}</button>
        ))}
        <i className="ind" style={{ transform: `translateX(${ind.x}px) scaleX(${ind.w / 100})` }} />
      </nav>
      <main id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <Suspense fallback={<Skeleton rows={5} label="loading globe" />}>
          {seen0 && <div className="view" style={tab === 0 ? undefined : { display: "none" }}><Mission {...common} active={tab === 0} /></div>}
          {tab !== 0 && <div className="view" key={tab}>
          {tab === 1 && <Fifo {...common} setRho={setRho} />}
          {tab === 2 && <Insights {...common} />}
          {tab === 3 && <Siting {...common} />}
          {tab === 4 && <QueriesView {...common} setQueries={setQueries} ms={ms} />}
          {tab === 5 && <Evidence {...common} />}
          {tab === 6 && <Economics data={data} />}
          {tab === 7 && <Hardware data={data} />}
          {tab === 8 && <About data={data} ms={ms} runs={runs} />}
          </div>}
        </Suspense>
      </main>
      <footer className="attr">Contains modified Copernicus Sentinel data 2023-2026 · © OpenStreetMap contributors (ODbL) · ESA WorldCover · JRC Global Surface Water · NASA POWER · Copernicus DEM · Natural Earth (globe imagery)</footer>
    </div>
  );
}
