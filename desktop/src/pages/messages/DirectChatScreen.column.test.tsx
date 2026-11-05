import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatPage } from "./direct-chat-contract";

// The column of the agents has its own width: a long last line under a name is one line cut with «…», and the column never
// scrolls sideways. (The page's layout is Tailwind classes that jsdom does not compute: the test holds the classes that keep
// the width — a grid track that may shrink, rows that may shrink, a one-line cut text — and the real layout was seen in a browser.)

function client(pages: Record<string, DirectChatPage["messages"]>): DirectChatClient {
  return {
    subscribe: vi.fn(async () => ({ state: "ready" as const })),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async ({ agentId }): Promise<DirectChatPage> => ({ messages: pages[agentId] ?? [], cursor: "c", questions: [] })),
    send: vi.fn(),
    answer: vi.fn(),
    close: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.restoreAllMocks();
});

const tokens = (element: Element) => (element.getAttribute("class") ?? "").split(/\s+/);

describe("DirectChatScreen: the column of the agents", () => {
  it("holds a fixed width, never scrolls sideways, and cuts a long last line to one line", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const at = Math.floor(Date.now() / 1000) - 60;
      const long = "assistente e mentor non mi rispondono in chat: ho provato tre volte oggi e anche ieri sera, nessuna risposta e nessun avviso ".repeat(3);
      const mock = client({ assistente: [{ id: "a1", role: "agent", text: long, at }] });
      render(<DirectChatScreen client={mock} initialAgentId="capitano" />);
      const nav = await screen.findByRole("navigation", { name: "Chat agenti" });
      await vi.advanceTimersByTimeAsync(200_000);
      const preview = await waitFor(() => screen.getByTestId("direct-chat-preview-assistente"));
      expect(preview).toHaveTextContent("assistente e mentor non mi rispondono");

      // the column: a fixed width that does not give way to its content
      const aside = nav.closest("aside")!;
      expect(tokens(aside)).toEqual(expect.arrayContaining(["w-60", "shrink-0", "overflow-hidden"]));
      // the list: one track that may be narrower than its content (a plain grid track grows to the longest line), no sideways scroll
      expect(tokens(nav)).toEqual(expect.arrayContaining(["grid", "grid-cols-[minmax(0,1fr)]", "overflow-x-hidden"]));
      // a row follows the track, and the line in it is one line cut with an ellipsis
      const row = within(nav).getByRole("button", { name: /^Assistente/ });
      expect(tokens(row)).toEqual(expect.arrayContaining(["w-full", "min-w-0"]));
      expect(tokens(preview)).toEqual(expect.arrayContaining(["block", "min-w-0", "truncate"]));
    } finally {
      vi.useRealTimers();
    }
  });
});
