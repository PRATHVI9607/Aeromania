// Canonical JSON for the evidence hash chain: keys sorted, no whitespace, number literals kept verbatim,
// strings escaped like Python json.dumps (ensure_ascii=True by default). hash = sha256(utf-8 canonical text without `hash`).
type Node = { t: "o"; v: [string, Node][] } | { t: "a"; v: Node[] } | { t: "s"; v: string } | { t: "n"; v: string } | { t: "l"; v: string };

export function parseRaw(text: string): Node {
  let i = 0;
  const ws = () => { while (i < text.length && " \t\r\n".includes(text[i])) i++; };
  const val = (): Node => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++; const v: [string, Node][] = []; ws();
      if (text[i] === "}") { i++; return { t: "o", v }; }
      for (;;) { ws(); const k = str(); ws(); i++; /* : */ v.push([k, val()]); ws(); if (text[i++] === "}") return { t: "o", v }; }
    }
    if (c === "[") {
      i++; const v: Node[] = []; ws();
      if (text[i] === "]") { i++; return { t: "a", v }; }
      for (;;) { v.push(val()); ws(); if (text[i++] === "]") return { t: "a", v }; }
    }
    if (c === '"') return { t: "s", v: str() };
    const m = /^(true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?)/.exec(text.slice(i, i + 40));
    if (!m) throw new Error(`bad JSON at ${i}`);
    i += m[0].length;
    return m[0][0] === "t" || m[0][0] === "f" || m[0][0] === "n" ? { t: "l", v: m[0] } : { t: "n", v: m[0] };
  };
  const str = (): string => {
    let j = i + 1;
    while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
    const s = JSON.parse(text.slice(i, j + 1)); i = j + 1; return s;
  };
  const r = val(); return r;
}

export function escStr(s: string, ensureAscii: boolean): string {
  let o = '"';
  for (let k = 0; k < s.length; k++) {
    const ch = s[k], c = s.charCodeAt(k);
    if (ch === '"') o += '\\"'; else if (ch === "\\") o += "\\\\";
    else if (ch === "\n") o += "\\n"; else if (ch === "\r") o += "\\r"; else if (ch === "\t") o += "\\t";
    else if (ch === "\b") o += "\\b"; else if (ch === "\f") o += "\\f";
    else if (c < 0x20 || (ensureAscii && c > 0x7e)) o += "\\u" + c.toString(16).padStart(4, "0");
    else o += ch;
  }
  return o + '"';
}

export function canon(n: Node, ensureAscii = true, drop?: string): string {
  switch (n.t) {
    case "n": case "l": return n.v;
    case "s": return escStr(n.v, ensureAscii);
    case "a": return "[" + n.v.map((x) => canon(x, ensureAscii)).join(",") + "]";
    case "o": return "{" + n.v.filter(([k]) => k !== drop).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => escStr(k, ensureAscii) + ":" + canon(x, ensureAscii)).join(",") + "}";
  }
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash of one card (raw JSON text of the card object), `hash` field excluded. */
export const cardHash = (cardText: string, ensureAscii = true) => sha256Hex(canon(parseRaw(cardText), ensureAscii, "hash"));

/** Split raw evidence text into per-card raw nodes plus plain parsed cards. */
export function cardsFromText(text: string): { cards: any[]; nodes: Node[] } {
  const root = parseRaw(text);
  const arr = root.t === "a" ? root : root.t === "o" ? (root.v.find(([k]) => k === "cards")?.[1] as Node) : undefined;
  if (!arr || arr.t !== "a") throw new Error("evidence.json: no cards array");
  const cards = JSON.parse(text);
  return { cards: Array.isArray(cards) ? cards : cards.cards, nodes: arr.v };
}

const ZERO = "0".repeat(64);
/** Chain anchors from evidence.json: genesis (prev_hash of card 0) and chain_head (hash of the last card), when present. */
export function chainMeta(text: string): { genesis: string; head: string | null } {
  const d = JSON.parse(text);
  return { genesis: (!Array.isArray(d) && d.genesis) || ZERO, head: (!Array.isArray(d) && d.chain_head) || null };
}
/** Link check for card i: prev_hash equals the previous hash (genesis for card 0); the last card must also equal chain_head. */
export function linkOk(cards: any[], i: number, m: { genesis: string; head: string | null }): boolean {
  return cards[i].prev_hash === (i === 0 ? m.genesis : cards[i - 1].hash) && (i !== cards.length - 1 || m.head === null || cards[i].hash === m.head);
}
/** Whole-chain verification used by the Gates and tests: every hash recomputes, every link holds, genesis and head anchor. */
export async function verifyChainText(text: string): Promise<{ ok: boolean; hashes: number; links: number; n: number }> {
  const { cards, nodes } = cardsFromText(text), m = chainMeta(text);
  let hashes = 0, links = 0;
  for (let i = 0; i < cards.length; i++) {
    const h1 = await sha256Hex(canon(nodes[i], true, "hash")), h2 = await sha256Hex(canon(nodes[i], false, "hash"));
    if (h1 === cards[i].hash || h2 === cards[i].hash) hashes++;
    if (linkOk(cards, i, m)) links++;
  }
  return { ok: hashes === cards.length && links === cards.length, hashes, links, n: cards.length };
}
