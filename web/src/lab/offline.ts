// Offline point check against the generated JSONs (no network). Pure; the UI passes the loaded files in.
import type { Tile } from "../types";
import { aoiBoxes, inBox, nearest, SITING_BOX, type Box, type LL } from "./geo";

export type Tone = "ok" | "warn" | "bad" | "dim";
export interface Verdict { text: string; tone: Tone }
export interface Ctx { tiles: Tile[]; sites: any[]; siting: any; siteIdx: Record<string, any>; cards: any[]; survey?: any }

export interface Lookup {
  aoi: string | null; siting: boolean;
  a1: { v: Verdict; site?: any; km?: number; tile?: Tile; imgs?: { t0: string; t1: string } };
  a2: { v: Verdict; cell?: any; top?: any; topKm?: number };
  c: { v: Verdict; card?: any; cardKm?: number; tile?: Tile; imgs?: { t0: string; t1: string } };
}
const OUT: Verdict = { text: "Outside coverage", tone: "dim" };

export function lookup(p: LL, x: Ctx): Lookup {
  const box: Box | undefined = aoiBoxes(x.tiles).find((b) => inBox(b, p));
  const aoi = box?.aoi ?? null, siting = inBox(SITING_BOX, p);
  const t1 = (a: string) => x.tiles.filter((t) => t.aoi === a && t.date === "t1");
  const r: Lookup = { aoi, siting, a1: { v: OUT }, a2: { v: OUT }, c: { v: OUT } };

  if (aoi === "blr") {
    const s = nearest(x.sites, p, 0.5), t = nearest(t1("blr"), p, 0.6)?.x, ix = nearest(Object.values(x.siteIdx).filter((i: any) => i.aoi === "blr"), p, 0.6)?.x as any;
    r.a1 = { site: s?.x, km: s?.km, tile: t, imgs: ix && { t0: `/data/${ix.files.t0}`, t1: `/data/${ix.files.t1}` },
      v: s ? { text: "New construction detected", tone: "warn" } : t && t.ha > 0 ? { text: `Change in tile (${t.ha.toFixed(1)} ha, below lead threshold)`, tone: "warn" } : { text: "No change", tone: "ok" } };
  } else if (aoi) r.a1 = { v: { text: "Not assessed (A1 covers Bengaluru)", tone: "dim" } };

  if (aoi === "hasdeo" || aoi === "sone") {
    const t = nearest(t1(aoi), p, 0.6)?.x, cd = nearest(x.cards.filter((c) => c.aoi === aoi), p, 5), near = cd && cd.km <= 1.0;
    const word = (k: string) => (k === "mine_expansion" ? "Mine expansion detected" : k === "forest_clearing" ? "Forest loss detected" : k === "sand_pits" ? "Sand pits flagged" : "Change detected");
    r.c = { card: cd?.x, cardKm: cd?.km, tile: t, imgs: cd && near ? { t0: `/data/img/ev_${cd.x.card_id}_t0.jpg`, t1: `/data/img/ev_${cd.x.card_id}_t1.jpg` } : undefined,
      v: near ? { text: word(cd!.x.kind), tone: "warn" } : t && t.ha > 0 ? { text: `${t.kind === "sand" ? "Sand" : "Forest/mine"} change in tile (${t.ha.toFixed(1)} ha)`, tone: "warn" } : { text: "No change", tone: "ok" } };
  } else if (aoi) r.c = { v: { text: "Not assessed (C covers Hasdeo and Son)", tone: "dim" } };

  if (siting) {
    const cell = nearest<any>(x.siting.cells, p, 1.5), top = nearest<any>(x.siting.top_solar, p, 2);
    const sc = cell?.x.solar_score ?? 0;
    r.a2 = { cell: cell?.x, top: top?.x, topKm: top?.km,
      v: top ? { text: `Shortlisted solar site (rank ${top.x.rank})`, tone: "ok" } : sc >= 80 ? { text: "Strong solar resource", tone: "ok" } : sc >= 40 ? { text: "Moderate solar resource", tone: "warn" } : { text: "Weak or excluded for solar", tone: "bad" } };
  }
  return r;
}
