import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatEvent, DirectChatMessage, DirectChatPage, DirectChatReceipt } from "./direct-chat-contract";

// What the chat costs when the person types, when a line arrives and while nothing happens. The cost of a
// line is its markdown parsed, so the count of those parses is the measure: it must not grow with the history.
// (Before the lines were memoized, each key typed parsed every line: 100 lines, 100 parses per key, 88 ms.)
const counts = vi.hoisted(() => ({ markdown: 0 }));
vi.mock("./chat-text", async (importOriginal) => {
  const real = await importOriginal<typeof import("./chat-text")>();
  return {
    ...real,
    renderChatMarkdown: (...args: Parameters<typeof real.renderChatMarkdown>) => {
      counts.markdown += 1;
      return real.renderChatMarkdown(...args);
    },
  };
});

const HISTORY = 200;
const BODY =
  "Ho letto il tuo profilo: **ottimo** il percorso su `Python` e *data*.\n\n- punto uno con [link](https://example.org)\n- punto due\n\nRAL < 50k e > 40k, ancora un paragrafo abbastanza lungo per sembrare una risposta vera di un agente.";

// Every call makes new objects, as every read of the native side does.
function history(n: number): DirectChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? ("agent" as const) : ("user" as const), text: `${i} ${BODY}`, at: 1000 + i }));
}

function client(n: number) {
  let onEvent: ((event: DirectChatEvent) => void) | undefined;
  // What the native side holds now: a read brings it (as new objects), so a late read never takes a line back.
  let latest = history(n);
  const mock: DirectChatClient = {
    subscribe: vi.fn(async ({ onEvent: next }) => {
      onEvent = next;
      return { state: "ready" as const };
    }),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async (): Promise<DirectChatPage> => ({ messages: latest.map((message) => ({ ...message })), cursor: "c" })),
    send: vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({ clientMessageId, accepted: true, messageId: "x", at: 2 })),
    close: vi.fn(),
  };
  const page = (messages: DirectChatMessage[]) => {
    latest = messages;
    return act(() => onEvent?.({ kind: "messages", agentId: "capitano", page: { messages, cursor: "c" } }));
  };
  return { mock, page };
}

async function opened() {
  const chat = client(HISTORY);
  render(<DirectChatScreen client={chat.mock} />);
  await screen.findByText(new RegExp(`^${HISTORY - 1} Ho letto`));
  const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
  return { ...chat, box };
}

afterEach(() => vi.useRealTimers());

describe("what the chat costs", () => {
  it("draws every line once when it opens", async () => {
    counts.markdown = 0;
    await opened();
    expect(counts.markdown).toBeGreaterThanOrEqual(HISTORY);
  });

  it("parses the markdown of no line when the person types", async () => {
    const { box } = await opened();
    counts.markdown = 0;
    let value = "";
    for (let i = 0; i < 40; i += 1) {
      value += "a";
      fireEvent.change(box, { target: { value } });
    }
    expect(box.value).toBe(value);
    expect(counts.markdown).toBe(0);
  });

  it("parses one line when one line arrives, not the history", async () => {
    const { page } = await opened();
    counts.markdown = 0;
    page([...history(HISTORY), { id: "new", role: "agent", text: "una nuova riga", at: 9999 }]);
    expect(await screen.findByText("una nuova riga")).toBeInTheDocument();
    expect(counts.markdown).toBe(1);
  });

  it("parses nothing when a page with the same lines is read again", async () => {
    const { page } = await opened();
    counts.markdown = 0;
    page(history(HISTORY));
    page(history(HISTORY));
    expect(counts.markdown).toBe(0);
  });

  it("parses one line when one line is edited by the next page", async () => {
    const { page } = await opened();
    counts.markdown = 0;
    const next = history(HISTORY);
    next[7] = { ...next[7], text: "riga cambiata" };
    page(next);
    expect(await screen.findByText("riga cambiata")).toBeInTheDocument();
    expect(counts.markdown).toBe(1);
  });

  it("parses nothing while it waits for a minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const chat = client(HISTORY);
    render(<DirectChatScreen client={chat.mock} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const reads = (chat.mock.read as ReturnType<typeof vi.fn>).mock.calls.length;
    counts.markdown = 0;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect((chat.mock.read as ReturnType<typeof vi.fn>).mock.calls.length - reads).toBeGreaterThan(30);
    expect(counts.markdown).toBe(0);
  });
});
