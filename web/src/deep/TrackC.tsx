import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "../data";
import { fetchJson } from "../data";
import { canon, cardsFromText, chainMeta, sha256Hex } from "../canon";
import { ha as fha } from "../fmt";
import { chainStatus, tamperNodes, type Node, type Status } from "./tamper";
import "./deep.css";

interface Ev { cards: any[]; nodes: Node[]; meta: { genesis: string; head: string | null } }
const KIND: Record<string, string> = { mine_expansion: "Mine expansion", forest_clearing: "Forest clearing", sand_pits: "Sand pits (experimental)" };
const kname = (k: string) => KIND[k] ?? k.replace(/_/g, " ");
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (h: string) => `${h.slice(0, 8)}...${h.slice(-6)}`;

/* ---------------------------------------------------------------- 1. case timeline */
function Frame({ src, alt, scale, mask, px = 192 }: { src: string; alt: string; scale: number; mask?: string | null; px?: number }) {
  const w = px * scale;
  return (
    <div className="deep-img" style={{ width: w, height: w }}>
      <img src={src} alt={alt} width={w} height={w} />
      {mask && <img className="m" src={mask} alt="" width={w} height={w} style={{ mixBlendMode: "normal" }} />}
      <span className="deep-north" aria-label="north is up"><svg width="12" height="14" viewBox="0 0 12 14" aria-hidden><path d="M6 0l5 12-5-3-5 3z" fill="#fff" /></svg><br />N</span>
      <span className="deep-scale" aria-label="scale bar 500 metres"><i style={{ width: 50 * scale }} />500 m</span>
    </div>
  );
}

function Swipe({ a, b, scale, la, lb }: { a: string; b: string; scale: number; la: string; lb: string }) {
  const [p, setP] = useState(50), el = useRef<HTMLDivElement>(null), w = 192 * scale;
  const at = (x: number) => { const r = el.current!.getBoundingClientRect(); setP(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100))); };
  return (
    <div className="deep-img deep-swipe" ref={el} style={{ width: w, height: w }} tabIndex={0} role="slider" aria-label={`Swipe between ${la} and ${lb}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e.clientX); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e.clientX); }}
      onKeyDown={(e) => { const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (d) { e.preventDefault(); setP((v) => Math.max(0, Math.min(100, v + d * (e.shiftKey ? 10 : 2)))); } }}>
      <img src={a} alt={la} width={w} height={w} />
      <div style={{ clipPath: `inset(0 0 0 ${p}%)` }}><img src={b} alt={lb} width={w} height={w} /></div>
      <i className="h" style={{ left: `${p}%` }} />
      <span className="deep-north" style={{ right: "auto", left: 6 }}>{la}</span><span className="deep-north">{lb}</span>
      <span className="deep-scale" aria-label="scale bar 500 metres"><i style={{ width: 50 * scale }} />500 m</span>
    </div>
  );
}

function Timeline({ card, site }: { card: any; site: any }) {
  const [mask, setMask] = useState(false);
  const f = site.files, u = (k: string) => `/data/${f[k]}`;
  const fr = [["t0", "t0 (before)"], ["c1", "c1"], ["t1", "t1 (after)"], ["c2", "c2"]] as const;
  return (
    <div>
      <div className="deep-row" style={{ marginBottom: 12 }}>
        <button aria-pressed={mask} onClick={() => setMask(!mask)}>Change mask {mask ? "on" : "off"}</button>
        <span className="deep-dim" style={{ fontSize: 12 }}>Pixels, not smoothed: 1 px = {site.px_m} m, drawn at 1x. Cloudy dates are not used as before or after.</span>
      </div>
      <div className="deep-strip">
        {fr.map(([k, label]) => {
          const cl = site.cloud?.[k], bad = cl > 0.3;
          return (
            <figure key={k} className="deep-fr" style={{ margin: 0 }}>
              <Frame src={u(k)} alt={`${card.card_id} ${label}, ${site.dates[k]}`} scale={1} mask={mask && (k === "t1" || k === "t0") ? u("mask") : null} />
              <figcaption className="deep-row" style={{ gap: 6 }}><span>{label} {site.dates[k]}</span><span className={`deep-chip ${bad ? "bad" : "ok"}`}>cloud {(cl * 100).toFixed(0)}%</span></figcaption>
            </figure>
          );
        })}
      </div>
      <h4 style={{ font: "600 13px var(--d-mono)", margin: "20px 0 8px" }}>Before / after swipe</h4>
      <Swipe a={u("t0")} b={u("t1")} scale={2} la="before" lb="after" />
    </div>
  );
}

/* ---------------------------------------------------------------- 2. radar */
function Radar({ card, site }: { card: any; site: any }) {
  const f = site.files, m = site.s1_mean_vh_db as Record<string, number> | undefined;
  const lab: [string, string, string][] = [["s1vh_t0", "t0", card.dates.t0], ["s1vh_t1", "t1", card.dates.t1], ["s1vh_monsoon", "monsoon", card.dates.monsoon_s1]];
  if (!f.s1vh_t0) return <p className="deep-dim">No Sentinel-1 crops for this case.</p>;
  const pts = m ? [["t0", m.t0], ["t1", m.t1], ["monsoon", m.monsoon]] as [string, number][] : [];
  const lo = Math.min(...pts.map((p) => p[1])) - 1, hi = Math.max(...pts.map((p) => p[1])) + 1;
  const W = 260, H = 170, X = (i: number) => 44 + i * 90, Y = (v: number) => 14 + ((hi - v) / (hi - lo)) * (H - 50);
  return (
    <div>
      <div className="deep-radar">
        {lab.map(([k, name, d]) => (
          <figure key={k} className="deep-fr" style={{ margin: 0 }}>
            <Frame src={`/data/${f[k]}`} alt={`Sentinel-1 VH ${name}, ${d}`} scale={1} />
            <figcaption>VH {name} {d}{m ? `: ${m[name]} dB` : ""}</figcaption>
          </figure>
        ))}
        {pts.length > 0 && (
          <div className="deep-chart">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mean VH backscatter in dB: ${pts.map((p) => `${p[0]} ${p[1]}`).join(", ")}`}>
              {pts.map((p, i) => <g key={p[0]}><rect x={X(i) - 22} y={Y(p[1])} width="44" height={H - 34 - Y(p[1])} fill={p[0] === "t1" ? "#f2a93b" : "#2d3742"} rx="2" /><text x={X(i)} y={Y(p[1]) - 4} fontSize="11" fill="#dde3ea" textAnchor="middle">{p[1]}</text><text x={X(i)} y={H - 18} fontSize="11" fill="#8e9ba8" textAnchor="middle">{p[0]}</text></g>)}
              <text x="4" y={H - 3} fontSize="10" fill="#8e9ba8">mean VH dB, whole crop</text>
            </svg>
          </div>
        )}
      </div>
      <p className="deep-lede" style={{ marginTop: 14, marginBottom: 0 }}>Forest canopy loss lowers VH backscatter; this is independent of the optical detector. On this card the radar change is dVH {card.s1?.dvh} dB (dVV {card.s1?.dvv} dB) between {card.dates.t0} and {card.dates.t1}. The monsoon scene is a seasonal reference: wet canopy raises backscatter, so a t1 that stays below t0 and the monsoon is the radar-consistent signature. The whole-crop mean moves less than the changed area does, because most of the crop did not change.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- 3. tamper */
function diffHash(a: string, b: string) { return [...b].map((c, i) => (c === a[i] ? c : <b key={i}>{c}</b>)); }

function Tamper({ ev, sel }: { ev: Ev; sel: number }) {
  const { cards, nodes, meta } = ev;
  const [st, setSt] = useState<Status | null>(null);
  const [shown, setShown] = useState<number | null>(null); // chain positions >= from are turned red up to `shown`
  const [info, setInfo] = useState<{ field: string; before: string; after: string; stored: string; now: string; idx: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const FIELD = "ha";
  const reset = () => { setSt(null); setShown(null); setInfo(null); };
  useEffect(reset, [ev, sel]);
  const run = async () => {
    const t = tamperNodes(nodes, sel, FIELD);
    if (!t) return;
    setBusy(true);
    const s = await chainStatus(cards, t.nodes, meta.genesis, meta.head);
    const now = await sha256Hex(canon(t.nodes[sel], true, "hash"));
    setInfo({ field: FIELD, before: t.before, after: t.after, stored: cards[sel].hash, now, idx: sel });
    setSt(s); setShown(sel - 1);
    for (let i = sel; i < cards.length; i++) { setShown(i); if (!reduced()) await sleep(140); }
    setBusy(false);
  };
  return (
    <div>
      <div className="deep-row">
        <button className="deep-pri" disabled={busy || !!info} onClick={run}>Try to tamper with card {sel + 1}</button>
        <button disabled={busy || !info} onClick={reset}>Reset</button>
        <span className="deep-dim" style={{ fontSize: 12 }}>Edits a copy in memory. Nothing on disk changes.</span>
      </div>
      <div className="deep-chain" role="list" aria-label="Evidence hash chain">
        {cards.map((c, i) => {
          const bad = st && shown !== null && i <= shown && !st.ok[i];
          return <div key={c.card_id} role="listitem" className={`deep-link ${bad ? "bad" : "ok"} ${i === sel ? "sel" : ""}`} title={`${c.card_id}: ${bad ? "chain broken here" : "verifies"}`} aria-label={`Card ${i + 1} ${c.card_id}: ${bad ? "broken" : "verifies"}`}>{i + 1}</div>;
        })}
      </div>
      <p aria-live="polite" className="deep-mono" style={{ fontSize: 12, minHeight: 18 }}>
        {info && st ? <>Flipped one character in <b className="deep-acc">{info.field}</b> of card {info.idx + 1} ({cards[info.idx].card_id}): <b>{info.before}</b> to <b className="deep-bad">{info.after}</b>. Chain breaks at card {info.idx + 1} and cards {info.idx + 2} to {cards.length} no longer verify ({st.ok.filter((x) => !x).length} of {cards.length} red).</> : "Chain verifies end to end."}
      </p>
      {info && (
        <div style={{ marginTop: 8 }}>
          <div className="deep-hash"><span className="deep-dim">stored    </span>{info.stored}</div>
          <div className="deep-hash"><span className="deep-dim">recomputed </span>{diffHash(info.stored, info.now)}</div>
        </div>
      )}
      <p className="deep-lede" style={{ marginTop: 12, marginBottom: 0 }}>Each card stores the SHA-256 of its own canonical JSON, and the next card stores that hash as <code>prev_hash</code>. Change any character and the card's recomputed hash no longer equals the one on file. Re-writing that hash to hide it would break the next card's <code>prev_hash</code>, and so on to the chain head published separately. An edit cannot stay hidden without rewriting every later card and the head.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- 4. certificate */
type Ver = { at: string; hashOk: boolean; linkOk: boolean; imgs: { key: string; sha: string; ok: boolean | null }[] };
function Certificate({ ev, sel, site }: { ev: Ev; sel: number; site: any }) {
  const card = ev.cards[sel];
  const [v, setV] = useState<Ver | null>(null);
  useEffect(() => {
    let dead = false; setV(null);
    (async () => {
      const [a, b] = await Promise.all([sha256Hex(canon(ev.nodes[sel], true, "hash")), sha256Hex(canon(ev.nodes[sel], false, "hash"))]);
      const prev = sel === 0 ? ev.meta.genesis : ev.cards[sel - 1].hash;
      const imgs = [];
      for (const [k, o] of Object.entries<any>(card.images ?? {})) {
        let ok: boolean | null = null;
        try { const r = await fetch(`/${o.path}`); ok = r.ok ? (await sha256Hex(await r.arrayBuffer())) === o.sha256 : false; } catch { ok = false; }
        imgs.push({ key: k, sha: o.sha256, ok });
      }
      if (!dead) setV({ at: new Date().toISOString(), hashOk: a === card.hash || b === card.hash, linkOk: card.prev_hash === prev, imgs });
    })();
    return () => { dead = true; };
  }, [ev, sel, card]);
  const pass = v && v.hashOk && v.linkOk && v.imgs.every((i) => i.ok);
  return (
    <div>
      <div className="deep-row" style={{ marginBottom: 14 }}><button className="deep-pri" disabled={!v} onClick={() => window.print()}>Print or save as PDF</button><span className="deep-dim" style={{ fontSize: 12 }}>Only the certificate is printed.</span></div>
      <article className="deep-cert" aria-label="Verification certificate">
        <h4>HERALD evidence verification</h4>
        <div>Case {card.card_id} · {kname(card.kind)}</div>
        <div className="rule" />
        <dl>
          <dt>Location</dt><dd>{card.lat}, {card.lon} (bbox {card.bbox.join(", ")}), AOI {card.aoi}</dd>
          <dt>Dates</dt><dd>before {card.dates.t0} · after {card.dates.t1} · S1 monsoon reference {card.dates.monsoon_s1}</dd>
          <dt>Changed area</dt><dd>{fha(card.ha, 2)}{card.n_pits != null ? `, ${card.n_pits} pits` : ""}</dd>
          <dt>Detector</dt><dd>{card.model.version}</dd>
          <dt>Thresholds</dt><dd>{Object.entries(card.model.thresholds ?? {}).map(([k, x]) => `${k}=${x}`).join(", ")}</dd>
          <dt>Sentinel-1</dt><dd>dVH {card.s1?.dvh} dB · dVV {card.s1?.dvv} dB{site?.s1_mean_vh_db ? ` · mean VH t0 ${site.s1_mean_vh_db.t0}, t1 ${site.s1_mean_vh_db.t1}, monsoon ${site.s1_mean_vh_db.monsoon} dB` : ""}</dd>
          <dt>Confidence</dt><dd>{card.confidence} ({card.confidence_basis})</dd>
          {Object.entries<any>(card.images ?? {}).map(([k, o]) => <><dt key={`t${k}`}>SHA-256 {k}</dt><dd key={`d${k}`}>{o.sha256}</dd></>)}
          <dt>Card hash</dt><dd>{card.hash}</dd>
          <dt>Previous hash</dt><dd>{card.prev_hash}</dd>
          <dt>Chain head</dt><dd>{ev.meta.head ?? "not published"}</dd>
          <dt>Verified at</dt><dd>{v ? v.at : "running..."}</dd>
          <dt>Result</dt><dd className="res">{v ? (pass ? "VERIFIED: card hash recomputed, link to previous card holds, image hashes match" : `FAILED: ${[!v.hashOk && "card hash", !v.linkOk && "link", v.imgs.some((i) => !i.ok) && "image hash"].filter(Boolean).join(", ")}`) : "..."}</dd>
        </dl>
        <div className="cav">Evidence lead, needs ground verification; not legal proof. {card.caveat} Land cover only, never people.</div>
      </article>
    </div>
  );
}

/* ---------------------------------------------------------------- 5. mine footprint */
function Footprint({ cards, sel, pick }: { cards: any[]; sel: number; pick: (i: number) => void }) {
  const rows = cards.map((c, i) => ({ c, i })).filter((x) => x.c.aoi === "hasdeo" && x.c.kind === "mine_expansion").sort((a, b) => b.c.ha - a.c.ha);
  if (!rows.length) return <p className="deep-dim">No mine-expansion cases in this evidence file.</p>;
  const tot = rows.reduce((s, x) => s + x.c.ha, 0), mx = rows[0].c.ha, top2 = rows[0].c.ha + (rows[1]?.c.ha ?? 0);
  return (
    <div>
      <div role="list">
        {rows.map(({ c, i }) => (
          <div className="deep-fp" role="listitem" key={c.card_id}>
            <button style={{ textAlign: "left", borderColor: i === sel ? "var(--d-acc)" : undefined }} onClick={() => pick(i)} aria-label={`Open case ${c.card_id}`}>{c.card_id}</button>
            <div><i style={{ width: `${(c.ha / mx) * 100}%` }} /></div><b style={{ textAlign: "right", fontWeight: 500 }}>{fha(c.ha, 2)}</b>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 14, font: "600 22px var(--d-mono)" }}><span className="deep-acc">{fha(tot, 2)}</span> <span className="deep-dim" style={{ font: "13px var(--sans,system-ui)" }}>across {rows.length} cases</span></p>
      <p className="deep-lede" style={{ marginBottom: 0 }}>The two largest cases, {rows[0].c.card_id} and {rows[1]?.c.card_id}, make up {((top2 / tot) * 100).toFixed(0)}% of the changed area, so a field team that visits those first covers most of the footprint. These are detector footprints between {rows[0].c.dates.t0} and {rows[0].c.dates.t1}, not surveyed boundaries.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- root */
export default function TrackC({ data }: { data: Data }) {
  const [ev, setEv] = useState<Ev | null | undefined>(undefined);
  const [sites, setSites] = useState<Record<string, any> | null>(null);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch("/data/evidence.json");
        if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) throw new Error("missing");
        const t = await r.text(), { cards, nodes } = cardsFromText(t);
        if (dead) return;
        setEv({ cards, nodes, meta: chainMeta(t) });
        setSel(Math.max(0, cards.findIndex((c: any) => c.kind === "mine_expansion")));
      } catch { if (!dead) setEv(null); }
    })();
    fetchJson("sites_index.json").then((s) => !dead && setSites(s ?? {}));
    return () => { dead = true; };
  }, []);
  void data;
  if (ev === undefined || sites === null) return <div className="deep"><p className="deep-dim">Loading evidence...</p></div>;
  if (ev === null) return <div className="deep"><div className="deep-err" role="alert">evidence.json is missing from /data.</div></div>;
  const card = ev.cards[sel], site = sites[`ev_${card.card_id}`];
  const sec = (n: string, t: string, id: string, lede: string, body: React.ReactNode) => (
    <section className="deep-sec" aria-labelledby={id}><header><span className="deep-n">{n}</span><h3 id={id}>{t}</h3></header><p className="deep-lede">{lede}</p>{body}</section>
  );
  return (
    <div className="deep" aria-label="Evidence deep dive">
      <div className="deep-row">
        <label htmlFor="deep-case" className="deep-dim" style={{ fontSize: 13 }}>Case</label>
        <select id="deep-case" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
          {ev.cards.map((c, i) => <option key={c.card_id} value={i}>{c.card_id} · {kname(c.kind)} · {fha(c.ha, 2)}</option>)}
        </select>
        <span className="deep-chip acc">{card.caveat ? "evidence lead, not legal proof" : "lead"}</span>
      </div>
      {site ? (<>
        {sec("C1", "Case timeline", "deep-c1", `${kname(card.kind)} at ${card.lat.toFixed(4)}, ${card.lon.toFixed(4)}: the four optical dates, the detector's change mask, and a before and after swipe.`, <Timeline card={card} site={site} />)}
        {sec("C2", "Radar check, independent of the optical detector", "deep-c2", "Sentinel-1 sees through cloud and measures structure, not colour.", <Radar card={card} site={site} />)}
      </>) : <div className="deep-err" role="alert">No imagery index for ev_{card.card_id} in sites_index.json.</div>}
      {sec("C3", "Try to tamper", "deep-c3", "Evidence is only useful if it cannot be quietly edited. Break one card and watch the chain.", <Tamper ev={ev} sel={sel} />)}
      {sec("C4", "Verification certificate", "deep-c4", "Recomputed in your browser from the files on this page, not read from a stored flag.", <Certificate ev={ev} sel={sel} site={site} />)}
      {sec("C5", "Mine footprint at Hasdeo Arand", "deep-c5", "Changed hectares per mine-expansion case, from the evidence cards.", <Footprint cards={ev.cards} sel={sel} pick={setSel} />)}
    </div>
  );
}
