import { useEffect, useId, useRef, useState } from "react";

const PATHS: Record<string, React.ReactNode> = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></>,
  restart: <><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v5h5" /></>,
  city: <><path d="M4 21V9l6-3v15M10 21V4l9 4v13M3 21h18" /><path d="M13 11h3M13 15h3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  tree: <><path d="M12 21v-6M12 15c-4 0-6-3-5-6 0-3 3-5 5-7 2 2 5 4 5 7 1 3-1 6-5 6z" /></>,
  wave: <><path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 14c3-3 6 3 9 0s6 3 9 0M3 20c3-3 6 3 9 0s6 3 9 0" /></>,
  map: <><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.500-6 11-6 11z" /><circle cx="12" cy="10" r="2" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" /></>,
  chev: <path d="m6 9 6 6 6-6" />,
};
export const Ico = ({ n }: { n: string }) => <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[n]}</svg>;

export interface Place { id: string; name: string; sub: string; ico: string }
/** "Fly to" combobox: one button, a listbox of places with icon + subtitle. Arrows, Enter, Esc. */
export function FlyTo({ places, value, onPick }: { places: Place[]; value: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false), [hi, setHi] = useState(0);
  const id = useId(), box = useRef<HTMLDivElement>(null);
  const cur = places.find((p) => p.id === value) ?? places[0];
  useEffect(() => {
    if (!open) return;
    const c = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", c); return () => window.removeEventListener("mousedown", c);
  }, [open]);
  const pick = (p: Place) => { onPick(p.id); setOpen(false); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!open) { setOpen(true); setHi(Math.max(0, places.indexOf(cur))); } else setHi((h) => (h + (e.key === "ArrowDown" ? 1 : places.length - 1)) % places.length); }
    else if (e.key === "Enter" && open) { e.preventDefault(); pick(places[hi]); }
    else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div className="flyto" ref={box} onKeyDown={key}>
      <span className="fl">Fly to</span>
      <button type="button" className="flybtn" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => { setOpen(!open); setHi(Math.max(0, places.indexOf(cur))); }}>
        <Ico n={cur.ico} /><span className="t"><b>{cur.name}</b><small>{cur.sub}</small></span><Ico n="chev" />
      </button>
      {open && <ul className="flylist" id={id} role="listbox" aria-label="Places">
        {places.map((p, i) => <li key={p.id} role="option" aria-selected={p.id === value} className={i === hi ? "hi" : ""} onMouseEnter={() => setHi(i)} onClick={() => pick(p)}>
          <Ico n={p.ico} /><span className="t"><b>{p.name}</b><small>{p.sub}</small></span></li>)}
      </ul>}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} className="sw" onClick={() => onChange(!checked)}><span className="trk"><i /></span>{label}</button>;
}
