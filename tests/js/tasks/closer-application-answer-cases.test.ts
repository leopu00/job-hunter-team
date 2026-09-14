/**
 * One answer rule for the dashboard and for Telegram. [JHT-CLOSER-ANSWERS]
 *
 * The dashboard validates a CLOSER answer in `web/lib/application-answer-request.ts`;
 * a Telegram reply is validated on the box by `shared/skills/application_answers.py`.
 * Both read the same cases from `shared/cloud/application-answer-cases.json`
 * (the Python side in `tests/test_application_answers.py`): an answer the
 * dashboard refuses must not slip in through the chat, and the reverse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertApplicationAnswerReply } from "../../../web/lib/application-answer-request";

type Case = {
  field_type: string;
  options: string[];
  reply: string;
  outcome: string;
};

const file = JSON.parse(
  readFileSync(
    join(__dirname, "../../../shared/cloud/application-answer-cases.json"),
    "utf-8",
  ),
) as { cases: Case[] };

describe("the dashboard answers the shared cases", () => {
  it("has cases to answer", () => {
    expect(file.cases.length).toBeGreaterThan(10);
  });

  for (const c of file.cases) {
    it(`${c.field_type} ${JSON.stringify(c.reply)} → ${c.outcome}`, () => {
      const payload = JSON.stringify({
        version: 1,
        position_id: 7,
        key: "fixture question",
        label: "Fixture question?",
        field_type: c.field_type,
        options: c.options,
      });
      let outcome = "ok";
      try {
        assertApplicationAnswerReply(payload, c.reply, 7);
      } catch (err) {
        outcome = (err as Error).message;
      }
      expect(outcome).toBe(c.outcome);
    });
  }
});
