import { useState, useEffect } from "react";
import type { Work } from "./work";

/** Status buttons + assignee + note for one lead or case. Saves on every change (parent persists to localStorage). */
export function WorkPanel({ w, options, onChange, who }: { w: Work | undefined; options: readonly { id: string; label: string }[]; onChange: (p: Partial<Work>) => void; who: string }) {
  const [note, setNote] = useState(w?.note ?? ""), [asg, setAsg] = useState(w?.assignee ?? "");
  useEffect(() => { setNote(w?.note ?? ""); setAsg(w?.assignee ?? ""); }, [w?.note, w?.assignee]);
  const cur = w?.status ?? "new";
  return (
    <section className="work" aria-label={`${who} status`}>
      <div className="seg wrap" role="group" aria-label="Status">
        {options.map((o) => <button key={o.id} className={cur === o.id ? "on" : ""} aria-pressed={cur === o.id} onClick={() => onChange({ status: o.id })}>{o.label}</button>)}
      </div>
      <div className="wrow">
        <label>Assignee<input value={asg} onChange={(e) => setAsg(e.target.value)} onBlur={() => asg !== (w?.assignee ?? "") && onChange({ assignee: asg })} placeholder="name or team" /></label>
        <label className="grow">Note<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (w?.note ?? "") && onChange({ note })} placeholder="what you saw, who you called, next step" /></label>
      </div>
      <p className="muted small">{w?.updated ? `Saved in this browser, ${new Date(w.updated).toLocaleString()}.` : "Saved in this browser (localStorage) when you set a status, assignee or note."}</p>
    </section>
  );
}
