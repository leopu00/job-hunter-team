import { describe, expect, it } from "vitest";
import { PROFILE_FIELD_KEYS, parseProfileProgressReply, progressFromReading } from "./contract";
import { PROFILE_PROGRESS_TEXT } from "./profile-progress.i18n";

function reply(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: 8,
    done: 3,
    ready: false,
    fields: [
      { key: "name", ok: true, preview: "Ada Rossi" },
      { key: "email", ok: true },
      { key: "target_role", ok: true, preview: "Backend engineer" },
      { key: "location", ok: false },
      { key: "experience_years", ok: false },
      { key: "seniority_target", ok: false },
      { key: "skills", ok: false, count: 1 },
      { key: "languages", ok: false, count: 0 },
    ],
    ...over,
  };
}

describe("the reply of the profile's read", () => {
  it("is the eight fields in the badge's order, and nothing else", () => {
    const reading = parseProfileProgressReply(reply());
    expect(reading?.fields.map((field) => field.key)).toEqual([...PROFILE_FIELD_KEYS]);
    expect(reading).toMatchObject({ required: 8, done: 3, ready: false });
  });

  it("never lets the email's text through, and cuts a long preview", () => {
    const rows = reply().fields.map((row) => (row.key === "email" ? { ...row, preview: "someone@example.org" } : row.key === "name" ? { ...row, preview: "x".repeat(200) } : row));
    const reading = parseProfileProgressReply(reply({ fields: rows }))!;
    expect(reading.fields[1]).toEqual({ key: "email", ok: true });
    expect(reading.fields[0].preview).toHaveLength(60);
  });

  it.each([
    ["an error", { ok: false, error: "profile_unavailable" }],
    ["no fields", { fields: [] }],
    ["seven fields", { fields: reply().fields.slice(0, 7) }],
    ["fields out of order", { fields: [...reply().fields].reverse() }],
    ["a count of done above the total", { done: 9 }],
    ["a negative done", { done: -1 }],
    ["a total that is not a number", { required: "8" }],
    ["a ready that is not a boolean", { ready: "yes" }],
    ["a row that is not an object", { fields: [...reply().fields.slice(0, 7), 3] }],
    ["a row with no ok", { fields: [{ key: "name" }, ...reply().fields.slice(1)] }],
  ])("is nothing for %s", (_, over) => {
    expect(parseProfileProgressReply(reply(over))).toBeNull();
  });

  it("is nothing for what is not an object", () => {
    for (const bad of [null, undefined, "ok", 3, []]) expect(parseProfileProgressReply(bad)).toBeNull();
  });

  it("becomes the card's fields: previews and counts as values, the email with none, filled as the team counted", () => {
    const progress = progressFromReading(parseProfileProgressReply(reply())!, PROFILE_PROGRESS_TEXT.it.fields);
    expect(progress.state).toBe("ready");
    expect(progress.filled).toBe(3);
    expect(progress.total).toBe(8);
    expect(progress.fields.map((field) => [field.key, field.value, field.done])).toEqual([
      ["name", "Ada Rossi", true],
      ["email", null, true],
      ["target_role", "Backend engineer", true],
      ["location", null, false],
      ["experience_years", null, false],
      ["seniority_target", null, false],
      ["skills", "1", false],
      ["languages", "0", false],
    ]);
    expect(progress.fields[0].label).toBe("Nome");
  });
});
