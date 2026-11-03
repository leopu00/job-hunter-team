import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeliveryMark, markOf } from "./DeliveryMark";
import { DIRECT_CHAT_TEXT } from "./direct-chat.i18n";

const t = DIRECT_CHAT_TEXT.it;

describe("the mark under a message of the person's", () => {
  it("is a clock while queued, a tick when sent, two ticks when the CLI took it, an arrow once answered", () => {
    expect(markOf({ kind: "queued" }, false)).toBe("queued");
    expect(markOf({ kind: "sent" }, false)).toBe("sent");
    expect(markOf({ kind: "sent", taken: true }, false)).toBe("read");
    expect(markOf({ kind: "sent", taken: true }, true)).toBe("answered");
    expect(markOf({ kind: "queued" }, true)).toBe("answered");
    // a line of the history, with no receipt in this view, is answered or has no mark: never «sent» by a guess
    expect(markOf(undefined, false)).toBeNull();
    expect(markOf(undefined, true)).toBe("answered");
  });

  it("leaves to the outcomes with their own words (not sent, expired, late, not known) their words", () => {
    for (const outcome of [{ kind: "notSent", presses: 0 }, { kind: "expired" }, { kind: "late" }, { kind: "unknown" }] as const) {
      expect(markOf(outcome, false), outcome.kind).toBeNull();
    }
  });

  it("says its word, in words as well as in a drawing, and what it means in its title", () => {
    for (const [mark, word] of [["queued", "In coda"], ["sent", "Inviato"], ["read", "Letto"], ["answered", "Risposto"]] as const) {
      const { unmount } = render(<DeliveryMark mark={mark} t={t} />);
      const line = screen.getByText(word).parentElement!;
      expect(line).toHaveAttribute("data-mark", mark);
      expect(line.getAttribute("title")).toBeTruthy();
      expect(line.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      unmount();
    }
  });
});
