import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASSISTANT_CHAT_FRAME, AssistantChatFrame } from "./AssistantChatFrame";

describe("the frame of the Assistant's chat in the onboarding", () => {
  it("has a height of its own, the window's, so the chat inside fills it and scrolls by itself", () => {
    render(
      <AssistantChatFrame label="Assistant">
        <div style={{ height: "100%" }} data-testid="chat" />
      </AssistantChatFrame>,
    );
    const frame = screen.getByTestId("onboarding-assistant-chat");
    expect(frame).toHaveAccessibleName("Assistant");
    expect(frame.style.height).toBe("calc(100svh / var(--zoom, 1))");
    expect(frame.style.overflow).toBe("hidden");
    expect(ASSISTANT_CHAT_FRAME.height).toContain("100svh");
    expect(frame).toContainElement(screen.getByTestId("chat"));
  });
});
