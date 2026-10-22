import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { wakeMessage } from "../src/parity/product-role.ts";

/**
 * The mailbox (shared/skills/jht_mail.py) quotes a peer's text the way `wakeMessage` does.
 * The hostile texts are the ones tests/test_jht_mail.py feeds to the mailbox: the same file,
 * so a case added on one side is tried on the other.
 */
const CASES: string[] = JSON.parse(
  readFileSync(resolve(__dirname, "../../../tests/fixtures/mail-quote-cases.json"), "utf-8"),
);

describe("a peer's text is quoted line by line, whatever breaks its lines", () => {
  for (const [index, text] of CASES.entries()) {
    it(`case ${index}`, () => {
      const out = wakeMessage("capitano", false, [{ from: "scout-1", to: "capitano-1", text, ts: 0 }]);
      const [header, ...body] = out.split("\n");
      expect(header).toBe("[from scout-1]");
      expect(body.length).toBeGreaterThan(0);
      expect(body.every((line) => line.startsWith("> "))).toBe(true);
    });
  }
});
