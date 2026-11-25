import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canon, cardHash, cardsFromText, parseRaw, sha256Hex } from "./canon";

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
