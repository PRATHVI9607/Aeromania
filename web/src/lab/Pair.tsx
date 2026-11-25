import { useState } from "react";
import type { Data } from "../data";
import { ChangeView } from "./ChangeView";
import { worker } from "./tiff";
import { analysePair, type PairRes } from "./pair";

const PAIRS = [["Bengaluru before/after", "blr_before.tif", "blr_construction.tif"], ["Hasdeo before/after", "hasdeo_before.tif", "hasdeo_mine.tif"]];
type Src = { name: string; get: () => Promise<ArrayBuffer> };
const url = (f: string): Src => ({ name: f, get: async () => { const r = await fetch(`/samples/${f}`); if (!r.ok) throw new Error(`${f} missing`); return r.arrayBuffer(); } });
const file = (f: File): Src => ({ name: f.name, get: () => f.arrayBuffer() });

export default function Pair({ data }: { data: Data }) {
  const [src, setSrc] = useState<(Src | null)[]>([null, null]), [res, setRes] = useState<PairRes | null>(null), [msg, setMsg] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const rate = (data.params as any).rupees_per_ha?.A ?? 84000;
  const run = async (s: (Src | null)[]) => {
    if (!s[0] || !s[1]) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      setMsg("reading GeoTIFFs");
      const [a, b] = await Promise.all([s[0].get().then(worker), s[1].get().then(worker)]);
      if (a.W !== b.W || a.H !== b.H) throw new Error(`Footprints differ: ${a.W}x${a.H} vs ${b.W}x${b.H} px. Use the same extent and grid for both.`);
      setRes(await analysePair(a.planar, b.planar, a.W, a.H, setMsg));
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(false); setMsg("");
  };
  const set = (i: number, s: Src) => { const n = [...src]; n[i] = s; setSrc(n); run(n); };
  const slot = (i: number, l: string) => (
    <label className="lab-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && set(i, file(e.dataTransfer.files[0])); }}>
      <input type="file" accept=".tif,.tiff" data-testid={`pair-file-${i}`} onChange={(e) => e.target.files?.[0] && set(i, file(e.target.files[0]))} />
      <b>{l}</b><span className="dim small">{src[i]?.name ?? "GeoTIFF, same footprint"}</span>
    </label>
  );
  return (
    <>
      <div className="lab-in">
        {slot(0, "Before")}{slot(1, "After")}
        <div className="lab-btns">{PAIRS.map(([l, a, b]) => <button key={l} disabled={busy} onClick={() => { const n = [url(a), url(b)]; setSrc(n); run(n); }}>{l}</button>)}</div>
      </div>
      {busy && <div className="lab-msg num">{msg}</div>}
      {err && <div className="lab-err" role="alert">{err}</div>}
      {res && <ChangeView r={res} rate={rate} />}
    </>
  );
}
