import { useEffect, useRef, useState } from "react";
import type { Data } from "../data";

const R_EARTH = 6371, RAD = Math.PI / 180;
const W2 = (lon: number) => ((lon + 540) % 360) - 180;
/** point at distance d (km) and bearing b (rad) from lat/lon (deg), for the coverage circles */
function dest(lat: number, lon: number, d: number, b: number): [number, number] {
  const la = lat * RAD, lo = lon * RAD, a = d / R_EARTH, la2 = Math.asin(Math.sin(la) * Math.cos(a) + Math.cos(la) * Math.sin(a) * Math.cos(b));
  return [la2 / RAD, W2((lo + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(la), Math.cos(a) - Math.sin(la) * Math.sin(la2))) / RAD)];
}
export interface Pick2D { t: string; d: any }
/** 2D equirectangular fallback of the Command center globe: same clock, same layers, no WebGL. */
export default function Flat2D({ data, t, layers, solar, aois, active, interp, capKm, onPick }: {
  data: Data; t: number; layers: Record<string, boolean>; solar: any[]; aois: Map<string, number[]>; active: Set<string>;
  interp: (track: Data["track"], t: number) => [number, number]; capKm: number; onPick: (o: Pick2D) => void;
}) {
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), [img, setImg] = useState<HTMLImageElement | null>(null), [sz, setSz] = useState<[number, number]>([0, 0]);
  const hits = useRef<{ x: number; y: number; o: Pick2D }[]>([]);
  useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.src = "/earth/earth_day_4096.jpg"; }, []);
  useEffect(() => {
    const el = box.current!, f = () => { const w = el.clientWidth, h = el.clientHeight, W = Math.min(w, h * 2); setSz([Math.floor(W), Math.floor(W / 2)]); };
    f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = cv.current!, [W, H] = sz; if (!W || !img) return;
    const dpr = Math.min(devicePixelRatio || 1, 2); c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr);
    const X = (lon: number) => ((lon + 180) / 360) * W, Y = (lat: number) => ((90 - lat) / 180) * H;
    g.drawImage(img, 0, 0, W, H); g.fillStyle = "rgba(10,14,20,.38)"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(230,237,243,.07)"; g.lineWidth = 1; g.beginPath();
    for (let lo = -150; lo <= 180; lo += 30) { g.moveTo(X(lo), 0); g.lineTo(X(lo), H); } for (let la = -60; la <= 60; la += 30) { g.moveTo(0, Y(la)); g.lineTo(W, Y(la)); } g.stroke();
    const path = (pts: [number, number][]) => { g.beginPath(); pts.forEach(([la, lo], i) => { const x = X(lo), y = Y(la); if (i === 0 || Math.abs(x - X(pts[i - 1][1])) > W / 2) g.moveTo(x, y); else g.lineTo(x, y); }); };
    if (layers.coverage) for (const s of data.stations) {
      const ring: [number, number][] = Array.from({ length: 73 }, (_, k) => dest(s.lat, s.lon, capKm, (k / 72) * 2 * Math.PI));
      const on = active.has(s.id); g.fillStyle = `rgba(34,211,238,${on ? 0.22 : 0.06})`; g.strokeStyle = `rgba(34,211,238,${on ? 0.9 : 0.4})`; g.lineWidth = 1;
      path(ring); if (!ring.some((p, i) => i && Math.abs(X(p[1]) - X(ring[i - 1][1])) > W / 2)) g.fill(); g.stroke();
    }
    if (layers.aoi) { g.strokeStyle = "#E6EDF3"; g.lineWidth = 1.5; g.font = "11px Geist, sans-serif"; g.fillStyle = "#E6EDF3"; for (const [id, b] of aois) { g.strokeRect(X(b[0]), Y(b[3]), Math.max(4, X(b[2]) - X(b[0])), Math.max(4, Y(b[1]) - Y(b[3]))); g.fillText(id, X(b[2]) + 4, Y(b[3])); } }
    const trail: [number, number][] = Array.from({ length: 101 }, (_, k) => interp(data.track, t - k)), ahead: [number, number][] = Array.from({ length: 101 }, (_, k) => interp(data.track, t + k));
    g.lineWidth = 1.5; g.strokeStyle = "rgba(245,165,36,.25)"; path(ahead); g.stroke(); g.lineWidth = 2.5; g.strokeStyle = "#F5A524"; path(trail); g.stroke();
    const h: typeof hits.current = [];
    const dots = (list: any[], t2: string, col: string, r: number, ring = false) => { for (const p of list) { const x = X(p.lon), y = Y(p.lat); g.fillStyle = col; g.strokeStyle = "#0A0E14"; g.lineWidth = ring ? 2 : 1; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); h.push({ x, y, o: { t: t2, d: p } }); } };
    if (layers.leads) dots((data.reports.sites_blr?.sites ?? []).filter((s: any) => s.category !== "agri_ambiguous"), "A", "rgba(245,165,36,.85)", 2.5);
    if (layers.solar) dots(solar, "S", "#F5A524", 6, true);
    if (layers.evidence) dots(data.reports.evidence?.cards ?? [], "C", "#34D399", 4.5, true);
    hits.current = h;
    const [la, lo] = interp(data.track, t);
    for (const s of data.stations) { const x = X(s.lon), y = Y(s.lat), on = active.has(s.id); g.fillStyle = "#22D3EE"; g.beginPath(); g.arc(x, y, on ? 6 : 4, 0, 7); g.fill(); if (on) { g.strokeStyle = "#22D3EE"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(X(lo), Y(la)); g.stroke(); }
      g.font = "500 11px Geist, sans-serif"; g.fillStyle = "#E6EDF3"; g.fillText(s.name.split(" (")[0], x + 8, y + 4); }
    g.fillStyle = "#F5A524"; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(X(lo), Y(la), 6, 0, 7); g.fill(); g.stroke();
  }, [sz, img, t, layers, data, solar, aois, active, interp, capKm]);
  return (
    <div className="flat2d" ref={box}>
      <canvas ref={cv} style={{ width: sz[0], height: sz[1] }} aria-label="2D map: ground track, stations, areas of interest"
        onClick={(e) => { const r = cv.current!.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best: Pick2D | null = null, bd = 100; for (const q of hits.current) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; best = q.o; } } if (best) onPick(best); }} />
    </div>
  );
}
