import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatMessage, DirectChatPage, DirectChatStatus } from "./direct-chat-contract";
import {
  loadSeen,
  newestAgentAt,
  UNREAD_FIRST_PEEK_MS,
  UNREAD_PEEK_MS,
  unreadAfter,
  unreadLabel,
  useChatUnread,
} from "./chat-unread";

const agent = (id: string, at: number): DirectChatMessage => ({ id, role: "agent", text: id, at });
const person = (id: string, at: number): DirectChatMessage => ({ id, role: "user", text: id, at });
const system = (id: string, at: number): DirectChatMessage => ({ id, role: "system", text: id, at });

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the unread count", () => {
  it("counts only what the agent wrote after the mark; the person's lines and the system's never count", () => {
    const messages = [agent("a", 10), person("p", 11), system("s", 12), agent("b", 13), agent("c", 14)];
    expect(newestAgentAt(messages)).toBe(14);
    expect(unreadAfter(messages, 10)).toBe(2);
    expect(unreadAfter(messages, 14)).toBe(0);
    expect(unreadAfter([person("p", 99), system("s", 100)], 0)).toBe(0);
    expect(newestAgentAt([person("p", 99)])).toBe(0);
  });

  it("is shown up to 99, then 99+", () => {
    expect(unreadLabel(7)).toBe("7");
    expect(unreadLabel(99)).toBe("99");
    expect(unreadLabel(100)).toBe("99+");
  });

  it("reads the marks back, and takes a damaged store for empty", () => {
    const store = (value: string | null) => ({ getItem: () => value });
    expect(loadSeen(store('{"mentor":12,"scout":"x","scorer":-1,"critico":null}'))).toEqual({ mentor: 12 });
    expect(loadSeen(store("not json"))).toEqual({});
    expect(loadSeen(store("[1,2]"))).toEqual({});
    expect(loadSeen(store(null))).toEqual({});
    expect(loadSeen({ getItem: () => { throw new Error("blocked"); } })).toEqual({});
    expect(loadSeen(null)).toEqual({});
  });
});

describe("the unread hook", () => {
  const AGENTS = ["capitano", "mentor", "scout"] as const;
  const setup = (pages: Record<string, DirectChatMessage[]>, props: { peeking?: boolean } = {}) => {
    const read = vi.fn(async ({ agentId }: { agentId: string }): Promise<DirectChatPage> => ({ messages: pages[agentId] ?? [] }));
    const hook = renderHook(
      ({ openAgent, openMessages, peeking }) => useChatUnread({ agents: AGENTS, openAgent, openMessages, read, peeking }),
      { initialProps: { openAgent: "capitano", openMessages: [] as DirectChatMessage[], peeking: props.peeking ?? true } },
    );
    return { read, hook, pages };
  };

  it("starts a chat seen for the first time at zero, then counts what comes after", async () => {
    const { read, hook, pages } = setup({ mentor: [agent("m1", 5), agent("m2", 6)] });
    await advance(UNREAD_FIRST_PEEK_MS);
    expect(read).toHaveBeenCalledWith({ agentId: "mentor" });
    expect(hook.result.current.counts.mentor ?? 0).toBe(0);
    expect(JSON.parse(window.localStorage.getItem("jht.desktop.chat.seen.v1")!)).toEqual({ mentor: 6 });
    // the next look is at another agent; the mentor writes meanwhile and is looked at again two rounds later
    pages.mentor = [agent("m1", 5), agent("m2", 6), agent("m3", 7), agent("m4", 8)];
    await advance(UNREAD_PEEK_MS * 2);
    expect(hook.result.current.counts.mentor).toBe(2);
    expect(hook.result.current.total).toBe(2);
  });

  it("clears the count when the chat is opened and keeps the mark after a restart", async () => {
    const { hook, pages } = setup({ mentor: [agent("m1", 5)] });
    await advance(UNREAD_FIRST_PEEK_MS);
    pages.mentor = [agent("m1", 5), agent("m2", 9)];
    await advance(UNREAD_PEEK_MS * 2);
    expect(hook.result.current.counts.mentor).toBe(1);
    hook.rerender({ openAgent: "mentor", openMessages: pages.mentor, peeking: true });
    expect(hook.result.current.counts.mentor).toBe(0);
    expect(loadSeen()).toMatchObject({ mentor: 9 });
    // a new window: the marks come back, nothing old is unread
    const again = setup({ mentor: pages.mentor });
    await advance(UNREAD_FIRST_PEEK_MS);
    expect(again.hook.result.current.counts.mentor ?? 0).toBe(0);
  });

  it("does not count the open chat as unread while the window is in view, and counts it while it is hidden", () => {
    const { hook } = setup({}, { peeking: false });
    hook.rerender({ openAgent: "capitano", openMessages: [agent("c1", 1)], peeking: false });
    expect(hook.result.current.counts.capitano ?? 0).toBe(0);
    expect(loadSeen()).toMatchObject({ capitano: 1 });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    hook.rerender({ openAgent: "capitano", openMessages: [agent("c1", 1), agent("c2", 2), agent("c3", 3)], peeking: false });
    expect(hook.result.current.counts.capitano).toBe(2);
    expect(loadSeen()).toMatchObject({ capitano: 1 });
  });

  it("looks at nothing while not peeking, while the window is hidden, or after the page is left", async () => {
    const off = setup({ mentor: [agent("m1", 1)] }, { peeking: false });
    await advance(UNREAD_PEEK_MS * 3);
    expect(off.read).not.toHaveBeenCalled();
    off.hook.unmount();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const hidden = setup({ mentor: [agent("m1", 1)] });
    await advance(UNREAD_PEEK_MS * 3);
    expect(hidden.read).not.toHaveBeenCalled();
    hidden.hook.unmount();

    vi.restoreAllMocks();
    const left = setup({ mentor: [agent("m1", 1)] });
    left.hook.unmount();
    await advance(UNREAD_PEEK_MS * 3);
    expect(left.read).not.toHaveBeenCalled();
  });

  it("goes on after an agent that cannot be read, and keeps the count it had", async () => {
    const read = vi.fn(async ({ agentId }: { agentId: string }): Promise<DirectChatPage> => {
      if (agentId === "mentor") throw { code: "agent_not_running" };
      return { messages: [agent("s1", 3)] };
    });
    const hook = renderHook(() => useChatUnread({ agents: AGENTS, openAgent: "capitano", openMessages: [], read, peeking: true }));
    await advance(UNREAD_FIRST_PEEK_MS + UNREAD_PEEK_MS * 2);
    expect(read.mock.calls.map(([request]) => request.agentId)).toEqual(expect.arrayContaining(["mentor", "scout"]));
    expect(hook.result.current.total).toBe(0);
  });
});

describe("the unread badge in the chat", () => {
  function client(pages: Record<string, DirectChatMessage[]>) {
    const initial: DirectChatStatus = { state: "ready" };
    const mock: DirectChatClient = {
      subscribe: vi.fn(async () => initial),
      status: vi.fn(async () => initial),
      reconnect: vi.fn(async (): Promise<DirectChatStatus> => initial),
      read: vi.fn(async ({ agentId }): Promise<DirectChatPage> => ({ messages: pages[agentId] ?? [] })),
      send: vi.fn(),
      close: vi.fn(),
    };
    return mock;
  }

  it("shows how many messages an agent wrote since it was open, says it to a screen reader, and clears it when opened", async () => {
    window.localStorage.setItem("jht.desktop.chat.seen.v1", JSON.stringify({ mentor: 5 }));
    const pages = { mentor: [agent("m1", 5), agent("m2", 6), agent("m3", 7)], capitano: [agent("c1", 1)] };
    render(<DirectChatScreen client={client(pages)} />);
    // the connection is made first (the effects of a state that act holds back start when it ends), then the list is
    // looked at in order: the Assistant first, then the Mentor
    await advance(10);
    await advance(UNREAD_FIRST_PEEK_MS + UNREAD_PEEK_MS + 1_000);
    const badge = screen.getByTestId("unread-mentor");
    expect(badge).toHaveTextContent("2");
    expect(badge).toHaveAttribute("aria-label", "2 messaggi non letti");
    expect(screen.queryByTestId("unread-scout")).toBeNull();
    expect(screen.queryByTestId("unread-capitano")).toBeNull();
    act(() => screen.getByRole("button", { name: /Mentor/ }).click());
    await advance(50);
    expect(screen.queryByTestId("unread-mentor")).toBeNull();
  });
});
