import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { canon, cardsFromText, chainMeta, linkOk, sha256Hex } from "../canon";
import type { ViewProps } from "./props";
import { Chip, Skeleton, ViewHead } from "../ui";
const SiteGlobe = lazy(() => import("./SiteGlobe"));
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

export function Evidence(_: ViewProps) {
  const [st, setSt] = useState<{ cards: any[]; nodes: any[]; meta: { genesis: string; head: string | null } } | null | undefined>(undefined);
  const [sel, setSel] = useState(0);
  const [res, setRes] = useState<Record<string, Res>>({});
  const [busy, setBusy] = useState(false);
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
  const cl = c.cloud_pct, dt = c.dates, ix = c.indices;
  const mdl = typeof c.model === "string" ? c.model : c.model?.version;

  return (
    <div>
      <ViewHead kicker="Track C" title="Forest lost to mining, timestamped from orbit"
        sub={<>Open-cast mine expansion into dense forest at Hasdeo Arand, 2023 to 2025, as hash-chained evidence cards. Sand mining at 10 m is <b>experimental</b> and weak (low precision); it needs sub-metre imagery or SAR time series. Land cover only, never people. The chain shows tamper evidence, not legal admissibility.</>} />
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
                <span className={`mono st2 ${rr ? (done(rr) ? (pass(rr) ? "ok" : "bad") : "acc") : "dim"}`}>{rr ? (done(rr) ? (pass(rr) ? "pass" : "FAIL") : "...") : "unverified"}</span>
              </button>); })}
          </div>
        </section>

        <section className="panel">
          <h3><span>{kindName(c.kind)} <span className="mono dim">{cid(c)}</span></span>
            {exp(c.kind) ? <Chip tone="warn">experimental</Chip> : <Chip tone="ok">{pctf(c.confidence)} audit precision</Chip>}</h3>
          {c.bbox && <div className="sitewrap"><Suspense fallback={<Skeleton rows={2} label="loading globe" />}><SiteGlobe bbox={c.bbox} lat={c.lat} lon={c.lon} imgUrl={imgs(c).find((x) => x.key === "t1")?.url ?? imgs(c)[0]?.url ?? ""} /></Suspense></div>}
          <div className="evimgs">{imgs(c).map((x) => <figure key={x.key}><img src={x.url} alt={`${cid(c)} ${x.key}`} width={240} height={240} /><figcaption className="mono">{dt?.[x.key] ?? x.key}</figcaption></figure>)}</div>
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
          <ul className="checks" aria-label="verification">
            {rows.map((w, j) => { const show = !!r && j < r.shown; return (
              <li key={w.label} className={show ? (w.ok ? "ok" : "bad") : ""} style={{ "--i": j } as React.CSSProperties}>
                <i className="tick">{show ? (w.ok ? "\u2713" : "\u00d7") : ""}</i><span>{w.label}</span><span className="mono dim">{show ? w.note : ""}</span></li>); })}
          </ul>
          <div className="hashes mono"><span className="dim">prev</span><span>{c.prev_hash}</span><span className="dim">hash</span><span>{c.hash}</span></div>
          {caveat && <p className="muted small">{Array.isArray(caveat) ? caveat.join(" ") : caveat}</p>}
        </section>
      </div>
    </div>
  );
}
