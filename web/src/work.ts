import { useCallback, useState } from "react";

/** localStorage-backed state. Reads fresh on mount so every view sees the same store; falls back to memory if storage is blocked. */
export function readLocal<T>(key: string, init: T): T {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : init; } catch { return init; }
}
export function useLocal<T>(key: string, init: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => readLocal(key, init));
  const set = useCallback((n: T | ((p: T) => T)) => setV((p) => {
    const x = typeof n === "function" ? (n as (p: T) => T)(p) : n;
    try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* quota or blocked: keep in memory */ }
    return x;
  }), [key]);
  return [v, set];
}

export interface Work { status: string; note: string; assignee: string; updated: string }
export type WorkStore = Record<string, Work>;
export const LEAD_KEY = "herald.leads.v1", CASE_KEY = "herald.cases.v1", SHORT_KEY = "herald.shortlist.v1";
export const LEAD_STATUS = [
  { id: "new", label: "New" }, { id: "inspect", label: "Inspect" }, { id: "dismissed", label: "Dismissed (false positive)" },
  { id: "approved", label: "Already approved" }, { id: "escalated", label: "Escalated" },
] as const;
export const CASE_STATUS = [
  { id: "new", label: "New" }, { id: "review", label: "Under review" }, { id: "visit", label: "Field visit ordered" },
  { id: "confirmed", label: "Closed: confirmed" }, { id: "notconfirmed", label: "Closed: not confirmed" },
] as const;

export const statusOf = (s: WorkStore, id: string) => s[id]?.status ?? "new";
/** Pure update used by the UI and the tests: set fields on many ids at once. */
export function applyPatch(s: WorkStore, ids: string[], patch: Partial<Work>, now = new Date().toISOString()): WorkStore {
  const o = { ...s };
  for (const id of ids) o[id] = { ...({ status: "new", note: "", assignee: "" } as Work), ...o[id], ...patch, updated: now };
  return o;
}
export function countStatus(s: WorkStore, ids: string[], all: readonly { id: string }[]): Record<string, number> {
  const c: Record<string, number> = Object.fromEntries(all.map((x) => [x.id, 0]));
  for (const id of ids) { const k = statusOf(s, id); c[k] = (c[k] ?? 0) + 1; }
  return c;
}

const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCSV(rows: Record<string, unknown>[], cols: string[]): string {
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}
export interface Pt { lat: number; lon: number; name: string; props: Record<string, unknown> }
export function toGeoJSON(pts: Pt[]) {
  return { type: "FeatureCollection", features: pts.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { name: p.name, ...p.props } })) };
}
const xml = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export function toKML(pts: Pt[], title = "HERALD"): string {
  const pm = pts.map((p) => `<Placemark><name>${xml(p.name)}</name><description>${xml(Object.entries(p.props).map(([k, v]) => `${k}: ${v}`).join("\n"))}</description><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(title)}</name>${pm}</Document></kml>\n`;
}
export function download(name: string, mime: string, text: string | Blob) {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
