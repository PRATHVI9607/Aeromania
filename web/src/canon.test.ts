import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canon, cardHash, cardsFromText, parseRaw, sha256Hex, verifyChainText } from "./canon";

// Fixture hashes were produced by python: sha256(json.dumps(card minus hash, sort_keys=True, separators=(",",":"))).
const text = readFileSync(resolve(__dirname, "evidence.fixture.json"), "utf-8");

describe("canonical JSON hashing", () => {
  const { cards, nodes } = cardsFromText(text);
  it("matches python for every card, including 4.0, 2.0, 1e-05 and non-ascii", async () => {
    for (let i = 0; i < cards.length; i++) {
      const node = nodes[i];
      const h = await sha256Hex(canon(node, true, "hash"));
      expect(h).toBe(cards[i].hash);
    }
  });
  it("keeps number literals verbatim", () => {
    expect(canon(parseRaw('{"b":2.0,"a":[1e-05]}'))).toBe('{"a":[1e-05],"b":2.0}');
  });
  it("chain links and tamper detection", async () => {
    expect(cards[1].prev_hash).toBe(cards[0].hash);
    const tampered = text.replace('"conf": 0.5', '"conf": 0.6');
    const n = cardsFromText(tampered).nodes[0];
    expect(await sha256Hex(canon(n, true, "hash"))).not.toBe(cards[0].hash);
    expect(typeof cardHash).toBe("function");
  });
});

describe("chain anchors", () => {
  const { cards } = cardsFromText(text);
  const head = cards[cards.length - 1].hash;
  const anchored = text.replace(/^\{/, `{"chain_head":"${head}","genesis":"${"0".repeat(64)}",`);
  it("passes untampered", async () => { expect((await verifyChainText(anchored)).ok).toBe(true); });
  it("fails when the last card is altered and its own hash recomputed (chain_head catches it)", async () => {
    const last = cards.length - 1, idx = anchored.lastIndexOf('"card_id"');
    const probe = anchored.slice(0, idx) + anchored.slice(idx).replace(/"card_id": "([^"]+)"/, '"card_id": "$1x"');
    const newHash = await sha256Hex(canon(cardsFromText(probe).nodes[last], true, "hash"));
    const h = probe.lastIndexOf(head);
    const forged = probe.slice(0, h) + newHash + probe.slice(h + head.length);
    expect(forged).not.toBe(anchored);
    const r = await verifyChainText(forged);
    expect(r.hashes).toBe(r.n); // every card hash is self-consistent...
    expect(r.ok).toBe(false); // ...but the last card no longer matches chain_head
  });
  it("fails when card 0 does not start at genesis", async () => {
    expect((await verifyChainText(anchored.replace('"genesis":"' + "0".repeat(64), '"genesis":"' + "1".repeat(64)))).ok).toBe(false);
  });
});
