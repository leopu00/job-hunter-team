import { describe, expect, it } from "vitest";
import { conversationTime, previewText } from "./chat-kinds";
import { lastLineOf } from "./chat-unread";

describe("the line of a conversation in the list", () => {
  it("says the last line in plain words, the person's own marked, the agent's mood tag and markdown taken out", () => {
    expect(previewText({ role: "agent", text: "[caldo] **Ne ho trovate** tre.\n\n- Roma", at: 1 }, "Tu")).toBe("Ne ho trovate tre. - Roma");
    expect(previewText({ role: "user", text: "Cerca   anche\na Milano", at: 1 }, "Tu")).toBe("Tu: Cerca anche a Milano");
    const long = previewText({ role: "agent", text: "parola ".repeat(100), at: 1 }, "Tu");
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith("…")).toBe(true);
  });

  it("gives today's lines a clock and another day's a short date", () => {
    const now = new Date(2026, 10, 3, 15, 0).getTime();
    const at = (d: Date) => d.getTime() / 1000;
    expect(conversationTime(at(new Date(2026, 10, 3, 9, 5)), "it-IT", now)).toBe("09:05");
    expect(conversationTime(at(new Date(2026, 10, 2, 23, 50)), "it-IT", now)).toMatch(/^2\s+nov/);
  });

  it("takes the newest line said by the person or the agent, never a system line or an empty one", () => {
    expect(lastLineOf([])).toBeNull();
    expect(
      lastLineOf([
        { id: "a", role: "user", text: "uno", at: 1 },
        { id: "b", role: "agent", text: "due", at: 2 },
        { id: "c", role: "system", text: "mail non presa", at: 3 },
        { id: "d", role: "agent", text: "   ", at: 4 },
      ]),
    ).toEqual({ role: "agent", text: "due", at: 2 });
  });
});
