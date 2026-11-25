import type { Data } from "../data";
import type { SchedOut, Tile } from "../types";

export interface Insight {
  id: string; track: "A" | "C"; aoi: string; title: string; sub: string; lat: number; lon: number; capMin: number; img: string; to: string;
  herald: { min: number; station: string } | null; fifo: { min: number; station: string } | null;
}
const near = (tiles: Tile[], aoi: string, lat: number, lon: number, date = "t1") => {
  let best = -1, bd = Infinity;
  tiles.forEach((t, i) => { if (t.aoi !== aoi || t.date !== date) return; const d = (t.lat - lat) ** 2 + ((t.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
};
/** first window that carries any level of the tile, for one policy */
const sentIn = (sel: [number, number, number][] | undefined, wins: Data["wins"], tile: number) => {
  let w = Infinity; for (const [i, , wi] of sel ?? []) if (i === tile && wi < w) w = wi;
  return Number.isFinite(w) ? { min: wins[w].end_min, station: wins[w].station } : null;
};
/** Insight cards for the Command center: top Bengaluru sites (Track A), top Hasdeo cases (Track C), each tied to the capturing tile and its scheduled downlinks. */
export function buildInsights(data: Data, out: SchedOut | null): Insight[] {
  const R = data.reports, res: Insight[] = [];
  const mk = (id: string, track: "A" | "C", aoi: string, title: string, sub: string, lat: number, lon: number, img: string, to: string, ti = near(data.tiles, aoi, lat, lon)) => {
    if (ti < 0) return;
    res.push({ id, track, aoi, title, sub, lat, lon, img, to, capMin: data.tiles[ti].t_cap_min, herald: sentIn(out?.results.H2.sel, data.wins, ti), fifo: sentIn(out?.results.B1.sel, data.wins, ti) });
  };
  const sites: any[] = R.sites_blr?.sites ?? [];
  // first Bengaluru capture of the replay: its largest changed tile, with the nearest native crop
  const bt = data.tiles.map((t, i) => [t, i] as const).filter(([t]) => t.aoi === "blr");
  if (bt.length) {
    const c0 = Math.min(...bt.map(([t]) => t.t_cap_min)), [tt, ti] = bt.filter(([t]) => t.t_cap_min === c0 && t.kind !== "none").sort((a, b) => b[0].sev - a[0].sev)[0] ?? [];
    if (tt) {
      const ns = sites.filter((s) => s.site != null).sort((a, b) => (a.lat - tt.lat) ** 2 + (a.lon - tt.lon) ** 2 - ((b.lat - tt.lat) ** 2 + (b.lon - tt.lon) ** 2))[0];
      const close = ns && Math.hypot(ns.lat - tt.lat, ns.lon - tt.lon) < 0.012;
      mk("blr-first", "A", "blr", `${Math.round(tt.ha)} ha new construction`, "Bengaluru, first capture", tt.lat, tt.lon, close ? `/data/img/sites/blr_site${ns.site}_t1.jpg` : "", "ledger", ti);
    }
  }
  sites.filter((s) => s.site != null && s.category !== "agri_ambiguous").sort((a, b) => a.rank - b.rank).slice(0, 3).forEach((s) => {
    mk(`blr${s.site}`, "A", "blr", `${Math.round(s.ha)} ha ${s.category === "new_layout" ? "new layout" : "new construction"}`, `Bengaluru, ${s.ward ?? "ward n/a"}`, s.lat, s.lon, `/data/img/sites/blr_site${s.site}_t1.jpg`, "ledger");
  });
  const cards: any[] = R.evidence?.cards ?? [];
  cards.filter((c) => c.aoi === "hasdeo" && c.audit_label === "real").sort((a, b) => b.ha - a.ha).slice(0, 2).forEach((c) => {
    mk(`ev${c.card_id}`, "C", "hasdeo", `${c.kind === "mine_expansion" ? "Mine expansion" : "Forest clearing"}, ${c.ha.toFixed(1)} ha`, "Hasdeo, evidence case", c.lat, c.lon, `/data/img/ev_${c.card_id}_t1.jpg`, "evidence");
  });
  return res.sort((a, b) => a.capMin - b.capMin);
}
