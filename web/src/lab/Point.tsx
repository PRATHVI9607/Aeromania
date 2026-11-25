import { useEffect, useMemo, useState } from "react";
import { fetchJson, type Data } from "../data";
import { BeforeAfter, Card, Chip } from "./Cards";
import { ChangeView } from "./ChangeView";
import { aoiBoxes, inBox, parseLatLon, type LL } from "./geo";
import { lookup, type Ctx } from "./offline";
import { findPair, power, readWindow, solarEcon, WIN, type Scene } from "./online";
import { analysePair, type PairRes } from "./pair";

const QUICK: [string, string][] = [["Bengaluru top lead", "13.104, 77.517"], ["Hasdeo", "22.83, 82.80"], ["Pavagada #1", "14.1788, 77.0631"], ["Son sand", "25.64, 84.61"]];
const f = (v: any, d = 1) => (typeof v === "number" ? v.toFixed(d) : v);

function Picker({ boxes, pick, p }: { boxes: ReturnType<typeof aoiBoxes>; pick: (p: LL) => void; p: LL | null }) {
  const [aoi, setAoi] = useState("blr");
  useEffect(() => { const h = p && boxes.find((x) => inBox(x, p)); if (h) setAoi(h.aoi); }, [p, boxes]);
  const b = boxes.find((x) => x.aoi === aoi);
  if (!b) return null;
  const mark = p && inBox(b, p) ? { l: ((p.lon - b.lon0) / (b.lon1 - b.lon0)) * 100, t: ((b.lat1 - p.lat) / (b.lat1 - b.lat0)) * 100 } : null;
  return (
    <div className="lab-pick">
      <div className="lab-btns">{boxes.map((x) => <button key={x.aoi} className={x.aoi === aoi ? "on" : ""} onClick={() => setAoi(x.aoi)}>{x.aoi}</button>)}</div>
      <div className="lab-map lab-pickmap" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); pick({ lon: b.lon0 + ((e.clientX - r.left) / r.width) * (b.lon1 - b.lon0), lat: b.lat1 - ((e.clientY - r.top) / r.height) * (b.lat1 - b.lat0) }); }}>
        <img src={`/data/img/${aoi}_t1.jpg`} alt={`${aoi} mosaic`} />
        {mark && <i className="lab-pin" style={{ left: `${mark.l}%`, top: `${mark.t}%` }} />}
      </div>
    </div>
  );
}

export default function Point({ data }: { data: Data }) {
  const [text, setText] = useState("13.104, 77.517"), [p, setP] = useState<LL | null>({ lat: 13.104, lon: 77.517 }), [ctx, setCtx] = useState<Ctx | null>(null);
  const [live, setLive] = useState<{ r: PairRes; a: Scene; b: Scene; econ: any; pw: any } | null>(null), [msg, setMsg] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const boxes = useMemo(() => aoiBoxes(data.tiles), [data.tiles]);
  const rate = (data.params as any).rupees_per_ha?.A ?? 84000;
  useEffect(() => { Promise.all([fetchJson("siting.json"), fetchJson("sites_index.json"), fetchJson("reports/siting.json")]).then(([siting, siteIdx]) => setCtx({ tiles: data.tiles, sites: data.reports.sites_blr?.sites ?? [], siting: siting ?? { cells: [], top_solar: [] }, siteIdx: siteIdx ?? {}, cards: data.reports.evidence?.cards ?? [] })); }, [data]);
  const set = (q: LL) => { setP(q); setText(`${q.lat.toFixed(4)}, ${q.lon.toFixed(4)}`); setLive(null); setErr(""); };
  const submit = (s: string) => { setText(s); const q = parseLatLon(s); setP(q); setLive(null); setErr(q ? "" : "Enter latitude, longitude (e.g. 13.10, 77.51)."); };
  const L = useMemo(() => (p && ctx ? lookup(p, ctx) : null), [p, ctx]);

  const analyse = async () => {
    if (!p) return;
    setBusy(true); setErr(""); setLive(null);
    try {
      setMsg("searching Earth Search STAC");
      const { after, before } = await findPair(p);
      setMsg(`reading COG windows ${before.datetime.slice(0, 10)} / ${after.datetime.slice(0, 10)}`);
      const [p0, p1, pw, rep] = await Promise.all([readWindow(before, p), readWindow(after, p), power(p).catch(() => null), fetchJson("reports/siting.json")]);
      const r = await analysePair(p0, p1, WIN, WIN, setMsg);
      setLive({ r, a: after, b: before, pw, econ: pw && rep ? solarEcon(pw, rep.params.solar) : null });
    } catch (e: any) { setErr(`Live analysis failed: ${String(e?.message ?? e)}`); }
    setBusy(false); setMsg("");
  };

  const a2live = live && (live.econ && live.pw ? (
    <Card code="A2" title="Solar / wind (NASA POWER)" verdict={live.econ.lcoe < live.econ.tariff ? "Solar viable at tariff (grid/road unknown)" : "Solar marginal at tariff (grid/road unknown)"} tone={live.econ.lcoe < live.econ.tariff ? "ok" : "warn"}
      rows={[["GHI kWh/m2/day", f(live.pw.ghi, 2)], ["T2M C", f(live.pw.t2m)], ["CUF", f(live.econ.cuf, 3)], ["cost Rs/kWh", f(live.econ.lcoe, 2)], ["tariff Rs/kWh (assumption)", f(live.econ.tariff, 2)], ["WS50M m/s", f(live.pw.ws50, 2)], ["open land in window", `${f(live.r.solar.usableHa)} ha`]]} />
  ) : undefined);

  return (
    <>
      <div className="lab-in">
        <form className="lab-ll" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
          <input value={text} onChange={(e) => submit(e.target.value)} placeholder="lat, lon" aria-label="latitude, longitude" data-testid="ll" spellCheck={false} />
          {p && <Chip tone="dim">{p.lat.toFixed(4)}, {p.lon.toFixed(4)}</Chip>}
        </form>
        <div className="lab-btns">{QUICK.map(([l, v]) => <button key={l} onClick={() => submit(v)}>{l}</button>)}</div>
      </div>
      {err && <div className="lab-err" role="alert">{err}</div>}
      <div className="lab-main">
        <Picker boxes={boxes} pick={set} p={p} />
        <div className="lab-pointcol">
          {L && p && <>
            <div className="lab-btns">
              <Chip tone={L.aoi ? "ok" : "dim"}>{L.aoi ? `AOI ${L.aoi}` : "outside our AOIs"}</Chip>
              {L.siting && <Chip tone="ok">Pavagada siting box</Chip>}
              <button className="lab-live" disabled={busy} onClick={analyse}>Analyse live (internet)</button>
            </div>
            <div className="lab-cards" data-testid="offline">
              <Card code="A1" title="Construction" verdict={L.a1.v.text} tone={L.a1.v.tone}
                rows={[["category", L.a1.site?.category], ["ha", f(L.a1.site?.ha ?? L.a1.tile?.ha)], ["ward", L.a1.site?.ward], ["confidence", f(L.a1.site?.confidence, 2)], ["rank / tier", L.a1.site ? `${L.a1.site.rank} / ${L.a1.site.tier}` : undefined], ["dates", L.a1.site || L.a1.tile ? "2023-02-07 to 2025-02-06" : undefined], ["distance", L.a1.km !== undefined ? `${L.a1.km.toFixed(2)} km` : undefined]]}>
                {L.a1.imgs && <BeforeAfter {...L.a1.imgs} />}
              </Card>
              <Card code="A2" title="Solar / wind" verdict={L.a2.v.text} tone={L.a2.v.tone}
                rows={[["solar score (percentile)", L.a2.cell?.solar_score], ["wind score", L.a2.cell?.wind_score], ["WS50M m/s", L.a2.cell?.ws50], ["road km", L.a2.cell?.road_km], ["cost Rs/kWh", f(L.a2.top?.lcoe_rs_kwh, 2)], ["tariff Rs/kWh (assumption)", L.a2.top ? f(ctx!.siting.params?.solar?.tariff, 2) : undefined], ["MW", L.a2.top?.mw], ["grid km", L.a2.top?.grid_km_substation]]} />
              <Card code="C" title="Forest / mining" verdict={L.c.v.text} tone={L.c.v.tone}
                rows={[["nearest card", L.c.card ? `${L.c.card.card_id} ${L.c.card.kind} (${L.c.cardKm!.toFixed(1)} km)` : undefined], ["ha", f(L.c.card && L.c.cardKm! <= 1 ? L.c.card.ha : L.c.tile?.ha)], ["dNDVI", f(L.c.card?.indices?.dndvi, 3)], ["S1 dVV / dVH dB", L.c.card?.s1?.dvv != null ? `${f(L.c.card.s1.dvv, 1)} / ${f(L.c.card.s1.dvh, 1)}` : undefined], ["confidence", f(L.c.card?.confidence, 2)]]}>
                {L.c.imgs && <BeforeAfter {...L.c.imgs} />}
              </Card>
            </div>
          </>}
        </div>
      </div>
      {busy && <div className="lab-msg num">{msg}</div>}
      {live && p && (
        <section className="lab-herald" data-testid="live">
          <h2>Live window, {WIN * 10 / 1000} km around {p.lat.toFixed(3)}, {p.lon.toFixed(3)}</h2>
          <div className="lab-mix"><Chip>before {live.b.datetime.slice(0, 10)} {live.b.id}</Chip><Chip>after {live.a.datetime.slice(0, 10)} {live.a.id}</Chip><Chip>cloud {live.b.cloud.toFixed(1)}% / {live.a.cloud.toFixed(1)}%</Chip><Chip>baseline {live.b.baseline} / {live.a.baseline}{live.a.baseline >= 4 ? " (BOA -1000)" : ""}</Chip></div>
          <ChangeView r={live.r} rate={rate} a2={a2live} />
          <p className="lab-note dim small">live Sentinel-2 L2A from Element84 Earth Search; results are leads, not verdicts</p>
        </section>
      )}
    </>
  );
}
