import { Fragment, useEffect, useState } from "react";
import { canon, cardsFromText, sha256Hex } from "../canon";
import type { ViewProps } from "./props";

type Res = { hash: boolean; link: boolean; imgs: { key: string; ok: boolean | null }[]; mode?: string };

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
const kv = (o: any): [string, string][] => Object.entries(o ?? {}).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]);

export function Evidence(_: ViewProps) {
  const [st, setSt] = useState<{ cards: any[]; nodes: any[] } | null | undefined>(undefined);
  const [sel, setSel] = useState(0);
  const [res, setRes] = useState<Record<string, Res>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadText().then((t) => { try { setSt(t ? cardsFromText(t) : null); } catch (e) { console.error(e); setSt(null); } }); }, []);
  if (st === undefined) return <div className="boot">loading</div>;
  if (st === null) return <section className="panel"><h3>Evidence <small>not generated yet</small></h3><p className="muted">web/public/data/evidence.json is missing. It is produced by the Track C evidence step.</p></section>;
  const { cards, nodes } = st;

  const verify = async () => {
    setBusy(true); setRes({});
    const out: Record<string, Res> = {};
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      let hash = false, mode = "";
      for (const asc of [true, false]) if (!hash && (await sha256Hex(canon(nodes[i], asc, "hash"))) === c.hash) { hash = true; mode = asc ? "ascii-escaped" : "utf-8"; }
      const link = i === 0 ? true : c.prev_hash === cards[i - 1].hash;
      const im = [];
      for (const x of imgs(c)) {
        let ok: boolean | null = null;
        try { const r = await fetch(x.url); if (r.ok) ok = (await sha256Hex(await r.arrayBuffer())) === x.sha; else ok = false; } catch { ok = false; }
        im.push({ key: x.key, ok });
      }
      out[cid(c)] = { hash, link, imgs: im, mode };
      setRes({ ...out });
    }
    setBusy(false);
  };
  const pass = (r?: Res) => !!r && r.hash && r.link && r.imgs.every((x) => x.ok);
  const c = cards[sel] ?? cards[0];
  const r = res[cid(c)];
  const s1 = c.s1 ?? c.s1_corroboration ?? c.corroboration;
  const caveat = c.caveat ?? c.caveats;
  const total = Object.keys(res).length, ok = Object.values(res).filter(pass).length;

  return (
    <div className="ins">
      <div className="kicker">Track C</div>
      <h2 className="headline">Sand and forest crimes, timestamped from orbit</h2>
      <p className="muted">Tamper-evident evidence leads for mines and forest departments, monsoon-proof with radar. Land-cover change only; cannot see people or vehicles. Leads need ground verification. The chain shows tamper evidence, not legal admissibility.</p>
      <div className="insgrid">
        <section className="panel">
          <h3>Cards <small>{cards.length}</small>
            <button className="primary" onClick={verify} disabled={busy}>{busy ? "verifying..." : "Verify chain"}</button></h3>
          {total > 0 && <p className={ok === total && total === cards.length ? "ok mono" : "bad mono"} aria-live="polite">{ok}/{total} cards pass{total < cards.length ? " (running)" : ""}</p>}
          <div className="leads" style={{ maxHeight: 520, width: 520 }} role="listbox" aria-label="evidence cards">
            {cards.map((x, i) => (
              <button key={cid(x)} className={sel === i ? "on" : ""} style={{ gridTemplateColumns: "100px 1fr 90px" }} onClick={() => setSel(i)} role="option" aria-selected={sel === i}>
                <span className="mono">{cid(x)}</span><span className="trunc">{x.aoi ?? ""} {x.kind ?? x.category ?? ""} {x.ha != null ? `${x.ha} ha` : ""}</span>
                <span className={`mono ${res[cid(x)] ? (pass(res[cid(x)]) ? "ok" : "bad") : ""}`}>{res[cid(x)] ? (pass(res[cid(x)]) ? "pass" : "FAIL") : "unverified"}</span>
              </button>))}
          </div>
        </section>
        <section className="panel">
          <h3>{cid(c)} <small>{c.aoi ?? ""}</small></h3>
          <div className="evimgs">{imgs(c).map((x) => <figure key={x.key}><img loading="lazy" src={x.url} alt={`${cid(c)} ${x.key}`} width={240} height={240} /><figcaption className="mono">{x.key}{r ? (r.imgs.find((m) => m.key === x.key)?.ok ? "  sha256 ok" : "  sha256 MISMATCH") : ""}</figcaption></figure>)}</div>
          <dl className="dl">
            {kv(Object.fromEntries(Object.entries(c).filter(([k]) => !["hash", "prev_hash", "images", "image_hashes", "image_sha256", "s1", "s1_corroboration", "corroboration", "caveat", "caveats"].includes(k)))).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono trunc2">{v}</dd></Fragment>)}
            {s1 && <><dt>S1 corroboration</dt><dd className="mono">{kv(s1).map(([k, v]) => `${k}: ${v}`).join("; ")}</dd></>}
            <dt>prev_hash</dt><dd className="mono hash">{c.prev_hash}</dd><dt>hash</dt><dd className="mono hash">{c.hash}</dd>
            {r && <><dt>verification</dt><dd className={`mono ${pass(r) ? "ok" : "bad"}`}>card hash {r.hash ? `ok (${r.mode})` : "MISMATCH"}; chain link {r.link ? "ok" : "BROKEN"}; images {r.imgs.length ? r.imgs.map((m) => `${m.key} ${m.ok ? "ok" : "bad"}`).join(", ") : "none listed"}</dd></>}
          </dl>
          {caveat && <p className="muted">{Array.isArray(caveat) ? caveat.join(" ") : caveat}</p>}
        </section>
      </div>
    </div>
  );
}
