import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatEvent, DirectChatPage, DirectChatReceipt, DirectChatStatus } from "./direct-chat-contract";

// The line «<agent> is working…»: it follows what the reads say of the agent's screen, and nothing else.

const ASKED = { id: "u1", role: "user" as const, text: "Ci sei?", at: 100 };
const ANSWERED = [ASKED, { id: "a1", role: "agent" as const, text: "Ok, ci lavoro.", at: 101 }];

function client(first: Partial<DirectChatPage> = {}, initial: DirectChatStatus = { state: "ready" }) {
  let onEvent: ((event: DirectChatEvent) => void) | undefined;
  const mock: DirectChatClient = {
    subscribe: vi.fn(async ({ onEvent: next }) => {
      onEvent = next;
      return initial;
    }),
    status: vi.fn(async () => initial),
    reconnect: vi.fn(async (): Promise<DirectChatStatus> => ({ state: "ready" })),
    read: vi.fn(async (): Promise<DirectChatPage> => ({ messages: [ASKED], cursor: "c", ...first })),
    send: vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({ clientMessageId, accepted: true, messageId: "u2", at: 2 })),
    close: vi.fn(),
  };
  const page = (value: DirectChatPage) => act(() => onEvent?.({ kind: "messages", agentId: "capitano", page: value }));
  return { mock, page, status: (value: DirectChatStatus) => act(() => onEvent?.({ kind: "status", status: value })) };
}

const line = () => screen.queryByTestId("direct-chat-working");

afterEach(() => {
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.restoreAllMocks();
});

describe("DirectChatScreen: the agent is working", () => {
  it("says it when the read says `working`, in the person's language, and not before", async () => {
    const quiet = client();
    const { unmount } = render(<DirectChatScreen client={quiet.mock} />);
    await screen.findByText("Ci sei?");
    expect(line()).toBeNull();
    unmount();

    const busy = client({ activity: "working" });
    render(<DirectChatScreen client={busy.mock} />);
    expect(await screen.findByTestId("direct-chat-working")).toHaveTextContent("Capitano sta lavorando…");
  });

  it("speaks the app's language", async () => {
    document.cookie = "NEXT_LOCALE=en; path=/";
    render(<DirectChatScreen client={client({ activity: "working" }).mock} />);
    expect(await screen.findByTestId("direct-chat-working")).toHaveTextContent("is working…");
  });

  it("stays after a first answer of the agent's while it goes on working, and goes when it is idle", async () => {
    const { mock, page } = client({ activity: "working" });
    render(<DirectChatScreen client={mock} />);
    await screen.findByTestId("direct-chat-working");
    page({ messages: ANSWERED, activity: "working" });
    expect(await screen.findByText("Ok, ci lavoro.")).toBeInTheDocument();
    expect(line()).not.toBeNull();
    page({ messages: ANSWERED, activity: "idle" });
    expect(line()).toBeNull();
  });

  it("never starts from a page that does not say, and holds one read before it goes", async () => {
    const { mock, page } = client();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Ci sei?");
    page({ messages: [ASKED] });
    expect(line()).toBeNull();
    page({ messages: [ASKED], activity: "working" });
    expect(line()).not.toBeNull();
    page({ messages: [ASKED] });
    expect(line()).not.toBeNull();
    page({ messages: [ASKED] });
    expect(line()).toBeNull();
  });

  it("is a line of the read-only view too: it only says what the agent does", async () => {
    render(<DirectChatScreen client={client({ activity: "working" }).mock} writeLocked />);
    expect(await screen.findByTestId("direct-chat-working")).toBeInTheDocument();
  });

  it("is not shown while the connection is not ready", async () => {
    const { mock, page, status } = client({ activity: "working" });
    render(<DirectChatScreen client={mock} />);
    await screen.findByTestId("direct-chat-working");
    status({ state: "error", code: "tunnel_unavailable" });
    expect(line()).toBeNull();
    status({ state: "ready" });
    page({ messages: [ASKED], activity: "working" });
    expect(line()).not.toBeNull();
  });
});
