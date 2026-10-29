import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageRow } from "./ChatMessageRow";
import ChatQuestion from "./ChatQuestion";
import { DIRECT_CHAT_TEXT } from "./direct-chat.i18n";
import type { DirectChatMessage, DirectChatQuestion } from "./direct-chat-contract";

const RAW = "- work_authorization: {'region': 'EU', 'status': 'Italian citizen - free movement'}";
const READABLE = "Work authorization: Italian citizen - free movement (EU)";

beforeEach(() => localStorage.setItem("jht-lang", "en"));
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("a record in the Assistant's words is shown readable in the chat", () => {
  it("in the profile card (a question)", () => {
    const question: DirectChatQuestion = {
      id: "aq:1",
      at: 100,
      kind: "question",
      subject: "Save this profile?",
      text: `I read your CV:\n${RAW}`,
      options: [],
      multiple: false,
      free: false,
      expiresAt: null,
      state: "open",
    };
    render(<ChatQuestion question={question} agentName="Assistant" t={DIRECT_CHAT_TEXT.en} canAnswer onAnswer={vi.fn(async () => null)} />);
    expect(screen.getByText(READABLE, { exact: false })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("{'region'");
  });

  it("in an Assistant message, but never in what the person typed", () => {
    const agent: DirectChatMessage = { id: "m1", at: 100, role: "agent", text: RAW } as DirectChatMessage;
    const user: DirectChatMessage = { id: "m2", at: 101, role: "user", text: RAW } as DirectChatMessage;
    const row = (message: DirectChatMessage) => (
      <ChatMessageRow
        message={message}
        t={DIRECT_CHAT_TEXT.en}
        agentLabel="Assistant"
        dateLocale="en"
        quoted={false}
        inFlight={false}
        enterAvailable={false}
        pressingThis={false}
        pressingAny={false}
        suggestionsOff={false}
        onMenu={vi.fn()}
        onSend={vi.fn()}
        onEnterAgain={vi.fn()}
      />
    );
    const { unmount } = render(row(agent));
    expect(document.body.textContent).toContain(READABLE);
    unmount();
    render(row(user));
    expect(document.body.textContent).toContain("{'region': 'EU'");
  });
});
