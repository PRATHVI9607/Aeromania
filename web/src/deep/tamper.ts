import { canon, parseRaw, sha256Hex } from "../canon";

export type Node = ReturnType<typeof parseRaw>;

/** Flip one character of a top-level field on a copy of card node `i` (raw literals are kept, so untouched cards still hash exactly as stored). */
export function tamperNodes(nodes: Node[], i: number, field: string): { nodes: Node[]; before: string; after: string } | null {
  const copy = structuredClone(nodes) as Node[];
  const o = copy[i];
  if (o.t !== "o") return null;
  const e = o.v.find(([k]) => k === field);
  if (!e || (e[1].t !== "n" && e[1].t !== "s")) return null;
  const before = e[1].v;
  const k = before.length - 1; // last char: a digit goes +1 mod 10, a letter becomes a different letter
  const ch = before[k], rep = /\d/.test(ch) ? String((Number(ch) + 1) % 10) : ch === "a" ? "b" : "a";
  const after = before.slice(0, k) + rep;
  e[1].v = after;
  return { nodes: copy, before, after };
}

export interface Status { hashOk: boolean[]; linkOk: boolean[]; ok: boolean[] }
/** Recompute every card hash from its (possibly edited) node and check each link against the stored previous hash, genesis and head. */
export async function chainStatus(cards: any[], nodes: Node[], genesis: string, head: string | null): Promise<Status> {
  const hashOk: boolean[] = [], linkOk: boolean[] = [];
  for (let i = 0; i < cards.length; i++) {
    const [a, b] = await Promise.all([sha256Hex(canon(nodes[i], true, "hash")), sha256Hex(canon(nodes[i], false, "hash"))]);
    hashOk.push(a === cards[i].hash || b === cards[i].hash);
    linkOk.push(cards[i].prev_hash === (i === 0 ? genesis : cards[i - 1].hash) && (i !== cards.length - 1 || head === null || cards[i].hash === head));
  }
  // a verifier trusts a card only if everything before it verified: first failure poisons every later card
  let bad = false;
  const ok = cards.map((_, i) => { bad = bad || !(hashOk[i] && linkOk[i]); return !bad; });
  return { hashOk, linkOk, ok };
}
