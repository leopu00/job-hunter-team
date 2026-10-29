import { describe, expect, it } from "vitest";
import { readableRecordText } from "./chat-readable-record";

describe("a record the Assistant wrote as the program holds it", () => {
  it("says the work authorization in words, in the person's language", () => {
    const raw = "- work_authorization: {'region': 'EU', 'status': 'Italian citizen - free movement'}";
    expect(readableRecordText(raw, "en")).toBe("- Work authorization: Italian citizen - free movement (EU)");
    expect(readableRecordText(raw, "it")).toBe("- Autorizzazione al lavoro: Italian citizen - free movement (EU)");
  });

  it("says any other flat record as its pairs, with double quotes and plain values too", () => {
    expect(readableRecordText("notice_period: {\"weeks\": 4, 'remote': True}", "en")).toBe("Notice period: Weeks: 4, Remote: True");
  });

  it("leaves what is not a flat record as it came: nested, a list, unclosed, a line of code", () => {
    for (const line of [
      "work_authorization: {'region': {'a': 1}}",
      "work_authorization: {'region': ['EU']}",
      "work_authorization: {'region': 'EU'",
      "skip_this: {}",
      "x = {'a_b': 1}",
      "my_var: int = 3",
    ]) expect(readableRecordText(line, "en")).toBe(line);
  });

  it("keeps the other lines and the text without any record exactly", () => {
    const text = "I read your CV.\n\nRole: Data analyst\nwork_authorization: {'region': 'EU', 'status': 'Citizen'}\nIs it right?";
    expect(readableRecordText(text, "en")).toBe("I read your CV.\n\nRole: Data analyst\nWork authorization: Citizen (EU)\nIs it right?");
    expect(readableRecordText("RAL < 50k: ok", "en")).toBe("RAL < 50k: ok");
  });
});
