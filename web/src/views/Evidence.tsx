import { useEffect, useMemo, useState } from "react";
import { canon, cardsFromText, chainMeta, linkOk, sha256Hex } from "../canon";
import type { ViewProps } from "./props";
import { Chip, Skeleton, ViewHead } from "../ui";
import { Tabs, Empty } from "../kit";
import { explain } from "../explain";
import { WorkPanel } from "../WorkPanel";
import { SiteDrawer, type SiteRef } from "../SiteDetail";
import { applyPatch, CASE_KEY, CASE_STATUS, countStatus, download, statusOf, useLocal, type WorkStore } from "../work";
import { lazy, Suspense } from "react";
import { Guard } from "../ui";
const Deep = lazy(() => import.meta.glob("../deep/TrackC.tsx")["../deep/TrackC.tsx"]?.() as Promise<any> ?? Promise.resolve({ default: () => <Empty title="Deep dive not installed">web/src/deep/TrackC.tsx is not present in this build.</Empty> }));
import { ha as fha, pctf } from "../fmt";

type Res = { hash: boolean; link: boolean; imgs: { key: string; ok: boolean | null }[]; mode?: string; shown: number };

async function loadText(): Promise<string | null> {
  for (const p of ["/data/evidence.json", "/data/reports/evidence.json"]) {
    try { const r = await fetch(p); if (r.ok && !(r.headers.get("content-type") ?? "").includes("html")) return await r.text(); } catch { /* next */ }
  }
  return null;
}
const cid = (c: any) => c.card_id ?? c.id;
// Image hash locations accepted: card.images / image_hashes / image_sha256 : {t0: sha | {sha256,file}, t1: ...}
function imgs(c: any): { key: string; sha: string; url: string }[] {
  const o = c.images ?? c.image_hashes ?? c.image_sha256 ?? {};
  return Object.entries(o).map(([k, v]: [string, any]) => ({
    key: k, sha: typeof v === "string" ? v : v.sha256 ?? v.sha, url: `/data/img/${typeof v === "object" && (v.file || v.path) ? (v.file ?? v.path).split("/").pop() : `ev_${cid(c)}_${k}.jpg`}`,
  }));
}
const KIND: Record<string, string> = { mine_expansion: "Mine expansion", forest_clearing: "Forest clearing", sand_pits: "Sand pits" };
const kindName = (k: string) => KIND[k] ?? k.replace(/_/g, " ");
const rank = (k: string) => (k === "mine_expansion" ? 0 : k === "forest_clearing" ? 1 : 2);
const exp = (k: string) => k.startsWith("sand");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sgn = (v: number) => `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(3)}`;
const IDX: Record<string, string> = { dndvi: "dNDVI vegetation", dndbi: "dNDBI built", dmndwi: "dMNDWI water", dbsi: "dBSI bare soil" };

export function Evidence(vp: ViewProps) {
  const [st, setSt] = useState<{ cards: any[]; nodes: any[]; meta: { genesis: string; head: string | null } } | null | undefined>(undefined);
  const [sel, setSel] = useState(0);
  const [res, setRes] = useState<Record<string, Res>>({});
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useLocal<WorkStore>(CASE_KEY, {});
  const [open, setOpen] = useState(false), [msg, setMsg] = useState("");
  useEffect(() => { loadText().then((t) => { try { setSt(t ? { ...cardsFromText(t), meta: chainMeta(t) } : null); } catch (e) { console.error(e); setSt(null); } }); }, []);
  // display order: mine_expansion (by ha), forest_clearing, then experimental sand kinds; chain order is untouched
  const order = useMemo(() => (st ? st.cards.map((_, i) => i).sort((a, b) => rank(st.cards[a].kind) - rank(st.cards[b].kind) || (st.cards[b].ha ?? 0) - (st.cards[a].ha ?? 0)) : []), [st]);
  if (st === undefined) return <Skeleton rows={6} />;
  if (st === null) return <section className="panel"><h3>Evidence <small>not generated yet</small></h3><p className="muted">web/public/data/evidence.json is missing. It is produced by the Track C evidence step.</p></section>;
  const { cards, nodes, meta } = st;

  const verify = async () => {
    setBusy(true); setRes({});
    const out: Record<string, Res> = {};
    for (let d = 0; d < order.length; d++) {
      const i = order[d], c = cards[i];
      setSel(d);
      let hash = false, mode = "";
      for (const asc of [true, false]) if (!hash && (await sha256Hex(canon(nodes[i], asc, "hash"))) === c.hash) { hash = true; mode = asc ? "ascii-escaped" : "utf-8"; }
      const link = linkOk(cards, i, meta);
      const im = [];
      for (const x of imgs(c)) {
        let ok: boolean | null = null;
        try { const r = await fetch(x.url); if (r.ok) ok = (await sha256Hex(await r.arrayBuffer())) === x.sha; else ok = false; } catch { ok = false; }
        im.push({ key: x.key, ok });
      }
      const rows = 2 + im.length;
      for (let n = 1; n <= rows; n++) { out[cid(c)] = { hash, link, imgs: im, mode, shown: n }; setRes({ ...out }); await sleep(120); }
    }
    setBusy(false);
  };
  const done = (r?: Res) => !!r && r.shown >= 2 + r.imgs.length;
  const pass = (r?: Res) => done(r) && r!.hash && r!.link && r!.imgs.every((x) => x.ok);
  const c = cards[order[sel]] ?? cards[0];
  const r = res[cid(c)];
  const s1 = c.s1 ?? c.s1_corroboration ?? c.corroboration;
  const caveat = c.caveat ?? c.caveats;
  const total = Object.values(res).filter(done).length, ok = Object.values(res).filter(pass).length;
  const rows: { label: string; ok: boolean | null; note: string }[] = [
    { label: "Card hash (sha256 of canonical JSON)", ok: r ? r.hash : null, note: r ? (r.hash ? r.mode ?? "" : "MISMATCH") : "" },
    { label: "Chain link (previous hash, genesis, chain head)", ok: r ? r.link : null, note: r ? (r.link ? "" : "BROKEN") : "" },
    ...(r ? r.imgs : imgs(c).map((x) => ({ key: x.key, ok: null }))).map((m) => ({ label: `Image ${m.key} sha256`, ok: m.ok, note: m.ok === false ? "MISMATCH" : "" })),
  ];
  const pack = async () => {
    setMsg("Verifying card before export...");
    let hash = false;
    for (const asc of [true, false]) if (!hash && (await sha256Hex(canon(nodes[order[sel]], asc, "hash"))) === c.hash) hash = true;
    const link = linkOk(cards, order[sel], meta);
    const files: Record<string, any> = {}; let imgOk = true;
    for (const x of imgs(c)) {
      try { const r = await fetch(x.url), buf = await r.arrayBuffer(), ok = (await sha256Hex(buf)) === x.sha; imgOk = imgOk && ok;
        let bin = ""; new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
        files[x.key] = { file: x.url.split("/").pop(), sha256_expected: x.sha, sha256_ok: ok, base64: btoa(bin) }; } catch { imgOk = false; files[x.key] = { sha256_expected: x.sha, sha256_ok: false }; }
    }
    if (!hash || !link || !imgOk) { setMsg(`Not exported: ${!hash ? "card hash mismatch. " : ""}${!link ? "chain link broken. " : ""}${!imgOk ? "image hash mismatch." : ""}`); return; }
    const w = work[cid(c)];
    download(`herald_evidence_${cid(c)}.json`, "application/json", JSON.stringify({ card: c, chain_proof: { prev_hash: c.prev_hash, hash: c.hash, chain_head: meta.head, genesis: meta.genesis, verified_in_browser: new Date().toISOString() }, images: files, case: w ?? { status: "new" } }, null, 1));
    setMsg(`Exported ${cid(c)}: card hash, chain link and ${Object.keys(files).length} image hashes verified first.`);
  };
  const stc = countStatus(work, cards.map(cid), CASE_STATUS);
  const ref: SiteRef | null = open && c.bbox !== undefined ? { id: `ev_${cid(c)}`, aoi: c.aoi, lat: c.lat, lon: c.lon, title: `${kindName(c.kind)}, ${fha(c.ha ?? 0, 1)}`, facts: [
    { k: "Area", v: <span className="mono">{fha(c.ha ?? 0, 2)}</span>, why: <>Changed pixels x 0.01 ha.</> },
    ...(c.indices ? [{ k: "Index change", v: <span className="mono small">{Object.entries(c.indices).map(([k, v]) => `${k.replace(/^d/, "\u0394")} ${sgn(v as number)}`).join(", ")}</span>, why: <>dNDVI: vegetation, falling means cleared. dNDBI: built-up. dMNDWI: water. dBSI: bare soil, rising means exposed ground.</> }] : []),
    ...(c.s1 ? [{ k: "Sentinel-1", v: <span className="mono small">dVV {sgn(c.s1.dvv)} dB, dVH {sgn(c.s1.dvh)} dB</span>, why: <>Radar backscatter change. Independent of cloud; a drop or rise of a few dB corroborates a surface change.</> }] : []),
    { k: "Audit precision", v: <span className="mono">{pctf(c.confidence)}</span>, why: <>{c.confidence_basis}</> }] } : null;
  const cl = c.cloud_pct, dt = c.dates, ix = c.indices;
  const mdl = typeof c.model === "string" ? c.model : c.model?.version;

  return (
    <div>
      <ViewHead explain={explain("evidence", vp.data)} kicker="Track C, forest and mines department" title="Case inbox: forest lost to mining, timestamped from orbit"
        sub={<>Open-cast mine expansion into dense forest at Hasdeo Arand, 2023 to 2025, as hash-chained evidence cards. Sand mining at 10 m is <b>experimental</b> and weak (low precision); it needs sub-metre imagery or SAR time series. Land cover only, never people. The chain shows tamper evidence, not legal admissibility.</>} />
      <div className="stcards" role="group" aria-label="Cases by status">{CASE_STATUS.map((o) => <div key={o.id} className="stcard"><b>{stc[o.id]}</b><span>{o.label}</span></div>)}</div>
      <div className="evgrid">
        <section className="panel">
          <h3>Evidence cards <small>{cards.length} in chain</small>
            <button className="primary" onClick={verify} disabled={busy}>{busy ? "Verifying..." : "Verify chain"}</button></h3>
          <div className="vbar" aria-hidden><i style={{ transform: `scaleX(${total / cards.length})` }} className={ok === total ? "" : "bad"} /></div>
          <p className={`mono small ${total === 0 ? "dim" : ok === total ? "ok" : "bad"}`} aria-live="polite">{total === 0 ? "not verified yet" : `${ok}/${total} cards pass${total < cards.length ? ", running" : ""}`}</p>
          <div className="cardlist" role="listbox" aria-label="evidence cards">
            {order.map((ci, d) => { const x = cards[ci], rr = res[cid(x)]; return (
              <button key={cid(x)} className={`ec ${sel === d ? "on" : ""}`} onClick={() => setSel(d)} role="option" aria-selected={sel === d}>
                <span className="mono dim">{cid(x)}</span>
                <span className="kn">{kindName(x.kind)}{exp(x.kind) && <Chip tone="warn" title="Sand mining at 10 m is experimental">experimental</Chip>}</span>
                <span className="mono r">{fha(x.ha ?? 0, 1)}</span>
                <span className={`stl ${statusOf(work, cid(x))}`}>{CASE_STATUS.find((o) => o.id === statusOf(work, cid(x)))?.label}</span><span className={`mono st2 ${rr ? (done(rr) ? (pass(rr) ? "ok" : "bad") : "acc") : "dim"}`}>{rr ? (done(rr) ? (pass(rr) ? "pass" : "FAIL") : "...") : "unverified"}</span>
              </button>); })}
          </div>
        </section>

        <section className="panel">
          <h3><span>{kindName(c.kind)} <span className="mono dim">{cid(c)}</span></span>
            {exp(c.kind) ? <Chip tone="warn">experimental</Chip> : <Chip tone="ok">{pctf(c.confidence)} audit precision</Chip>}</h3>
          <div className="evimgs">{imgs(c).map((x) => <figure key={x.key}><img src={x.url} alt={`${cid(c)} ${x.key}`} width={240} height={240} loading="lazy" decoding="async" /><figcaption className="mono">{dt?.[x.key] ?? x.key}</figcaption></figure>)}</div>
          
          <dl className="dl">
            <dt>Area</dt><dd className="mono">{fha(c.ha ?? 0, 2)}{c.n_pits ? `, ${c.n_pits} pits` : ""}</dd>
            <dt>Place</dt><dd className="mono">{c.aoi}, {c.lat?.toFixed(4)}, {c.lon?.toFixed(4)}</dd>
            {dt && <><dt>Dates</dt><dd className="mono">{dt.t0} <span className="dim">to</span> {dt.t1}{dt.monsoon_s1 && <span className="dim"> , S1 monsoon {dt.monsoon_s1}</span>}</dd></>}
            {cl && <><dt>Cloud cover</dt><dd className="chips">{Object.entries(cl).map(([k, v]) => <Chip key={k}>{k} {(v as number).toFixed(0)}%</Chip>)}</dd></>}
            {ix && <><dt>Index change</dt><dd className="chips">{Object.entries(ix).map(([k, v]) => <Chip key={k} title={IDX[k]}>{k.replace(/^d/, "\u0394")} {sgn(v as number)}</Chip>)}</dd></>}
            {s1 && <><dt>Sentinel-1</dt><dd className="chips">{s1.dvv != null && <Chip>dVV {sgn(s1.dvv)} dB</Chip>}{s1.dvh != null && <Chip>dVH {sgn(s1.dvh)} dB</Chip>}
              {s1.monsoon_activity != null && <Chip tone={s1.monsoon_activity ? "acc" : undefined}>{s1.monsoon_activity ? "monsoon activity" : "no monsoon activity"}</Chip>}</dd></>}
            {mdl && <><dt>Model</dt><dd className="small">{String(mdl).split(";").map((p) => p.trim()).join(" / ")}</dd></>}
            {c.confidence_basis && <><dt>Confidence</dt><dd className="small">{c.confidence_basis}</dd></>}
          </dl>
          <button onClick={() => setOpen(true)}>Open 10 m imagery and locator</button>
          <WorkPanel w={work[cid(c)]} options={CASE_STATUS} who="Case" onChange={(p) => setWork((s) => applyPatch(s, [cid(c)], p))} />
          <div className="bulk"><button className="primary" onClick={pack}>Verify and download evidence pack</button><span className="muted small" aria-live="polite">{msg}</span></div>
          <ul className="checks" aria-label="verification">
            {rows.map((w, j) => { const show = !!r && j < r.shown; return (
              <li key={w.label} className={show ? (w.ok ? "ok" : "bad") : ""} style={{ "--i": j } as React.CSSProperties}>
                <i className="tick">{show ? (w.ok ? "\u2713" : "\u00d7") : ""}</i><span>{w.label}</span><span className="mono dim">{show ? w.note : ""}</span></li>); })}
          </ul>
          <div className="hashes mono"><span className="dim">prev</span><span>{c.prev_hash}</span><span className="dim">hash</span><span>{c.hash}</span></div>
          {caveat && <p className="muted small">{Array.isArray(caveat) ? caveat.join(" ") : caveat}</p>}
        </section>
      </div>
      {ref && <SiteDrawer key={ref.id} site={ref} data={vp.data} onClose={() => setOpen(false)} />}
    </div>
  );
}
