import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen, { groupRepeatedMessages, newLineAt, renderChatText, systemLineText } from "./DirectChatScreen";
import type {
  VoiceInputBridge,
  VoiceInputSnapshot,
  VoiceTranscriptEvent,
} from "../../lib/voice-input";
import type {
  DirectChatClient,
  DirectChatEvent,
  DirectChatPage,
  DirectChatReceipt,
  DirectChatStatus,
} from "./direct-chat-contract";
import { ERROR_CATALOG } from "../../lib/error-catalog";

const VOICE_IDLE: VoiceInputSnapshot = {
  available: true,
  phase: "idle",
  microphonePermission: "unknown",
  speechPermission: "unknown",
  transcript: "",
  error: null,
};

function voiceBridge(snapshot: VoiceInputSnapshot = VOICE_IDLE) {
  const transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();
  const mock: VoiceInputBridge = {
    status: vi.fn(async () => snapshot),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    onState: vi.fn(async () => () => undefined),
    onTranscript: vi.fn(async (listener) => {
      transcriptListeners.add(listener);
      return () => transcriptListeners.delete(listener);
    }),
  };
  return {
    mock,
    transcript: (event: VoiceTranscriptEvent) =>
      transcriptListeners.forEach((listener) => listener(event)),
  };
}

function client(initial: DirectChatStatus = { state: "ready" }) {
  let onEvent: ((event: DirectChatEvent) => void) | undefined;
  const mock: DirectChatClient = {
    subscribe: vi.fn(async ({ onEvent: next }) => {
      onEvent = next;
      return initial;
    }),
    status: vi.fn(async () => initial),
    reconnect: vi.fn(async (): Promise<DirectChatStatus> => ({ state: "ready" })),
    read: vi.fn(async (): Promise<DirectChatPage> => ({
      messages: [
        { id: "a1", role: "agent", text: "Messaggio dalla VPS", at: 1 },
      ],
      cursor: "opaque-cursor",
    })),
    send: vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({
      clientMessageId,
      accepted: true,
      messageId: "remote-user-1",
      at: 2,
    })),
    close: vi.fn(),
  };
  return { mock, emit: (event: DirectChatEvent) => onEvent?.(event) };
}

function viewport(width: number, height: number, zoom = "1.15") {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  document.documentElement.style.setProperty("--zoom", zoom);
}

afterEach(() => {
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--zoom");
  vi.restoreAllMocks();
});

describe("DirectChatScreen", () => {
  it.each([
    [1440, 900, "1"],
    [900, 420, "1"],
    [1000, 480, "1.4"],
    [480, 420, "1.15"],
  ])(
    "confines the chat at %sx%s with zoom %s and only scrolls the transcript",
    async (width, height, zoom) => {
      viewport(Number(width), Number(height), String(zoom));
      const { mock } = client();
      render(<DirectChatScreen client={mock} />);
      await screen.findByText("Messaggio dalla VPS");

      const shell = screen.getByTestId("direct-chat-shell");
      const transcript = screen.getByTestId("direct-chat-transcript");
      const composer = screen.getByTestId("direct-chat-composer");
      const composerRow = screen.getByTestId("direct-chat-composer-row");
      const input = screen.getByRole("textbox", { name: "Scrivi a Capitano" });
      const conversation = screen.getByRole("region", { name: "Conversazione con Capitano" });
      expect(shell).toHaveStyle({ height: "calc(100svh / var(--zoom, 1) - 3.5rem)" });
      expect(shell.className).toMatch(/min-h-0/);
      expect(shell.className).toMatch(/overflow-hidden/);
      expect(conversation.className).toMatch(/min-h-0/);
      expect(conversation.className).toMatch(/overflow-hidden/);
      expect(transcript.className).toMatch(/flex-1/);
      expect(transcript.className).toMatch(/min-h-0/);
      expect(transcript.className).toMatch(/overflow-y-auto/);
      expect(shell.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
      expect(composer.className).toMatch(/shrink-0/);
      expect(composer.className).not.toMatch(/absolute|fixed|sticky/);
      expect(composerRow.className).toMatch(/flex-wrap/);
      expect(input.className).toMatch(/min-w-0/);
      expect(input.className).toMatch(/flex-\[1_1_16rem\]/);
    },
  );

  it("a message refused because the VPS is not claimed yet offers the claim and keeps what was typed", async () => {
    viewport(1280, 800);
    const { mock } = client();
    mock.send = vi.fn(async () => {
      throw { code: "own_vps_claim_required" };
    });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "Ciao{Enter}");
    const invite = await screen.findByTestId("own-vps-invite");
    expect(invite).toHaveTextContent("devi confermare che è la tua");
    expect(screen.getByTestId("direct-chat-status")).toHaveTextContent(/non si scrive/i);
    // the text typed is back in the box: nothing was lost
    expect(screen.getByRole("textbox", { name: "Scrivi a Capitano" })).toHaveValue("Ciao");
  });

  it("the read-only chat never offers the claim", async () => {
    viewport(1280, 800);
    const { mock, emit } = client();
    render(<DirectChatScreen client={mock} writeLocked />);
    await screen.findByText("Messaggio dalla VPS");
    // even an error that asks for the claim: the read-only view has no claim to make
    act(() => emit({ kind: "error", operation: "send", code: "own_vps_claim_required" }));
    expect(await screen.findByTestId("direct-chat-status")).toHaveTextContent(/non si scrive/i);
    expect(screen.queryByTestId("own-vps-invite")).toBeNull();
  });

  it("selects an agent, reads its direct history and sends through the typed client", async () => {
    viewport(1280, 800);
    const { mock, emit } = client();
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");

    await user.click(screen.getByRole("button", { name: "Scout" }));
    await waitFor(() => expect(mock.read).toHaveBeenCalledWith({ agentId: "scout" }));
    expect(screen.getByRole("region", { name: "Conversazione con Scout" })).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Scrivi a Scout" });
    await user.type(input, "Controlla le nuove posizioni{Enter}");
    await waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith({
        agentId: "scout",
        text: "Controlla le nuove posizioni",
        clientMessageId: expect.any(String),
      }),
    );
    expect(await screen.findByText("Controlla le nuove posizioni")).toBeInTheDocument();

    emit({
      kind: "messages",
      agentId: "scout",
      page: { messages: [{ id: "a2", role: "agent", text: "Ne ho trovate tre.", at: 3 }] },
    });
    expect(await screen.findByText("Ne ho trovate tre.")).toBeInTheDocument();
  });

  it("places a final voice transcript in the editable composer without sending or uploading it", async () => {
    viewport(1280, 800);
    const { mock } = client();
    const voice = voiceBridge();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} voiceInputBridge={voice.mock} />);
    await screen.findByRole("button", { name: /detta un messaggio/i });

    act(() => voice.transcript({ text: "controlla i colloqui di domani", isFinal: true }));

    const input = screen.getByRole("textbox", { name: "Scrivi a Capitano" });
    expect(input).toHaveValue("controlla i colloqui di domani");
    expect(mock.send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.type(input, " e prepara un riepilogo");
    expect(mock.send).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Invia" }));
    await waitFor(() => expect(mock.send).toHaveBeenCalledWith({
      agentId: "capitano",
      text: "controlla i colloqui di domani e prepara un riepilogo",
      clientMessageId: expect.any(String),
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a safe tunnel error and retries without exposing raw transport output", async () => {
    viewport(1000, 500);
    const { mock } = client({ state: "error", code: "/private/key user@host" });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);

    const status = await screen.findByTestId("direct-chat-status");
    expect(status).toHaveTextContent("Team non disponibile.");
    expect(status).not.toHaveTextContent("/private/key");
    await user.click(within(status).getByRole("button", { name: "Riprova" }));
    expect(mock.reconnect).toHaveBeenCalledOnce();
    await waitFor(() => expect(status).toHaveTextContent("Team collegato"));
  });

  it("says the connection does not answer when it stays in «connecting», with the retry, instead of waiting in silence", async () => {
    viewport(1000, 500);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { mock } = client({ state: "connecting" });
      render(<DirectChatScreen client={mock} />);
      const status = await screen.findByTestId("direct-chat-status");
      expect(status).toHaveTextContent("Connessione sicura al team");
      expect(within(status).queryByRole("button", { name: "Riprova" })).toBeNull();

      await act(async () => { vi.advanceTimersByTime(8_100); });
      expect(status).toHaveTextContent("La connessione al team non risponde");
      expect(status).toHaveAttribute("role", "alert");
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(within(status).getByRole("button", { name: "Riprova" }));
      expect(mock.reconnect).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed read on the bar when a «ready» follows, and clears it when a later read gets through", async () => {
    viewport(1000, 500);
    const { mock, emit } = client({ state: "ready" });
    vi.mocked(mock.read).mockRejectedValueOnce({ code: "read_failed" });
    render(<DirectChatScreen client={mock} />);
    const status = await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(status).toHaveAttribute("role", "alert"));

    // the connection says «ready» again: it did not read, so the failure is still there
    act(() => emit({ kind: "status", status: { state: "ready" } }));
    expect(status).toHaveAttribute("role", "alert");

    // the next read gets through: the bar is calm again
    await waitFor(() => expect(status).toHaveAttribute("role", "status"), { timeout: 8_000 });
  }, 12_000);

  it("still ends a connection error when the connection comes back", async () => {
    viewport(1000, 500);
    const { mock, emit } = client({ state: "ready" });
    render(<DirectChatScreen client={mock} />);
    const status = await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(status).toHaveAttribute("role", "status"));
    act(() => emit({ kind: "error", operation: "connect", code: "tunnel_unavailable" }));
    expect(status).toHaveAttribute("role", "alert");
    act(() => emit({ kind: "status", status: { state: "ready" } }));
    expect(status).toHaveAttribute("role", "status");
  });

  it("keeps a failure the native side reports for a read or a send when a «ready» follows", async () => {
    viewport(1000, 500);
    const { mock, emit } = client({ state: "ready" });
    render(<DirectChatScreen client={mock} />);
    const status = await screen.findByTestId("direct-chat-status");
    await waitFor(() => expect(status).toHaveAttribute("role", "status"));
    act(() => emit({ kind: "error", operation: "send", code: "tunnel_unavailable" }));
    expect(status).toHaveAttribute("role", "alert");
    act(() => emit({ kind: "status", status: { state: "ready" } }));
    expect(status).toHaveAttribute("role", "alert");
  });

  it("does not say it while the connection is made in time", async () => {
    viewport(1000, 500);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { mock, emit } = client({ state: "connecting" });
      render(<DirectChatScreen client={mock} />);
      const status = await screen.findByTestId("direct-chat-status");
      await act(async () => { vi.advanceTimersByTime(3_000); });
      act(() => emit({ kind: "status", status: { state: "ready" } }));
      await act(async () => { vi.advanceTimersByTime(10_000); });
      expect(status).toHaveTextContent("Team collegato");
      expect(status).not.toHaveTextContent("non risponde");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells a known error with the app's sentence and action, never the raw code", async () => {
    viewport(1000, 500);
    const { mock } = client({ state: "error", code: "tunnel_unavailable" });
    render(<DirectChatScreen client={mock} />);

    const status = await screen.findByTestId("direct-chat-status");
    // the bar exists while the status is still «connecting»: wait for the error it is told with
    await waitFor(() => expect(status).toHaveTextContent(ERROR_CATALOG.tunnel_unavailable.text.it));
    expect(status).toHaveTextContent(ERROR_CATALOG.tunnel_unavailable.action.it);
    expect(status).not.toHaveTextContent("tunnel_unavailable");
    expect(status).not.toHaveTextContent("Codice");
  });

  it("polls the bounded history and reveals an asynchronous agent reply without switching", async () => {
    vi.useFakeTimers();
    const { mock } = client();
    vi.mocked(mock.read)
      .mockResolvedValueOnce({
        messages: [{ id: "initial", role: "user", text: "Prima domanda", at: 1 }],
        cursor: "cursor-after-initial",
      })
      .mockResolvedValueOnce({
        messages: [
          { id: "initial", role: "user", text: "Prima domanda", at: 1 },
          { id: "reply", role: "agent", text: "Risposta asincrona", at: 2 },
        ],
        cursor: "cursor-after-reply",
      });

    render(<DirectChatScreen client={mock} initialAgentId="assistente" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Prima domanda")).toBeInTheDocument();
    expect(mock.read).toHaveBeenCalledWith({ agentId: "assistente" });

    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Risposta asincrona")).toBeInTheDocument();
    expect(mock.read).toHaveBeenLastCalledWith({ agentId: "assistente" });
  });

  // A slow link (Windows to a VPS: one ssh connection per read). Fake timers; `after` advances the
  // clock and lets the reads that came due settle.
  async function slowLinkPage(status: DirectChatStatus = { state: "ready", link: "per-command" }) {
    vi.useFakeTimers();
    const { mock } = client(status);
    const flush = () => act(async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    const after = async (ms: number) => {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
      await flush();
    };
    render(<DirectChatScreen client={mock} initialAgentId="assistente" />);
    await flush();
    const reads = () => vi.mocked(mock.read).mock.calls.length;
    return { mock, flush, after, reads };
  }

  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("on a slow link reads every 10 s, and every 2 s for the 30 s after a send", async () => {
    const { mock, flush, after, reads } = await slowLinkPage();
    expect(reads()).toBe(1);
    await after(9_999);
    expect(reads()).toBe(1);
    await after(1);
    expect(reads()).toBe(2);

    const input = screen.getByRole("textbox", { name: "Scrivi a Assistente" });
    fireEvent.change(input, { target: { value: "Ci sei?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(mock.send).toHaveBeenCalledTimes(1);
    await after(1_999);
    expect(reads()).toBe(2);
    await after(1);
    expect(reads()).toBe(3);
    await after(1_999);
    expect(reads()).toBe(3);
    await after(1);
    expect(reads()).toBe(4);

    // past the 30 s, back to 10 s
    await after(30_000);
    const settled = reads();
    await after(9_999);
    expect(reads()).toBe(settled);
    await after(1);
    expect(reads()).toBe(settled + 1);
  });

  it("on a slow link does not read while the window is hidden or not focused, and reads at once when it is back", async () => {
    const { after, reads } = await slowLinkPage();
    setVisibility("hidden");
    await after(120_000);
    expect(reads()).toBe(1);
    setVisibility("visible");
    await after(0);
    expect(reads()).toBe(2);
    await after(10_000);
    expect(reads()).toBe(3);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await after(120_000);
    expect(reads()).toBe(3);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await after(0);
    expect(reads()).toBe(4);
  });

  it("on a slow link waits twice as long after each ssh_rate_limited, up to 60 s, and is back to 10 s after a read", async () => {
    const { mock, after, reads } = await slowLinkPage();
    vi.mocked(mock.read).mockRejectedValue({ code: "ssh_rate_limited" });
    await after(10_000); // refused: the next in 20 s
    expect(reads()).toBe(2);
    for (const wait of [20_000, 40_000, 60_000, 60_000]) {
      const before = reads();
      await after(wait - 1);
      expect(reads(), `no read before ${wait} ms`).toBe(before);
      await after(1);
      expect(reads(), `a read at ${wait} ms`).toBe(before + 1);
    }
    vi.mocked(mock.read).mockResolvedValue({ messages: [] });
    await after(60_000); // this one gets through
    const through = reads();
    await after(10_000);
    expect(reads()).toBe(through + 1);
  });

  it("on a slow link a refusal right after a send still waits 20 s, not twice the 2 s of the send", async () => {
    const { mock, flush, after, reads } = await slowLinkPage();
    const input = screen.getByRole("textbox", { name: "Scrivi a Assistente" });
    fireEvent.change(input, { target: { value: "Ci sei?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    vi.mocked(mock.read).mockRejectedValue({ code: "ssh_rate_limited" });
    await after(2_000); // refused, 2 s after the send
    const refused = reads();
    await after(19_999);
    expect(reads(), "no read before 20 s").toBe(refused);
    await after(1);
    expect(reads()).toBe(refused + 1);
  });

  it("on a VPS reached through the ssh master (macOS, Linux) keeps reading every 1.5 s, hidden or refused", async () => {
    const { mock, after, reads } = await slowLinkPage({ state: "ready" });
    setVisibility("hidden");
    await after(1_500);
    expect(reads()).toBe(2);
    vi.mocked(mock.read).mockRejectedValue({ code: "ssh_rate_limited" });
    await after(1_500);
    await after(1_500);
    expect(reads()).toBe(4);
  });

  it("on a slow link gives the next read the cursor of the last one, and only there", async () => {
    const { mock, after } = await slowLinkPage();
    vi.mocked(mock.read).mockResolvedValueOnce({ messages: [], cursor: "51200" });
    await after(10_000);
    expect(vi.mocked(mock.read).mock.calls[0][0]).toEqual({ agentId: "assistente" });
    expect(vi.mocked(mock.read).mock.calls[1][0]).toEqual({ agentId: "assistente", cursor: "opaque-cursor" });
    await after(10_000);
    expect(vi.mocked(mock.read).mock.calls[2][0]).toEqual({ agentId: "assistente", cursor: "51200" });
    vi.useRealTimers();
  });

  it("through the ssh master reads without a cursor, as before", async () => {
    const { mock, after } = await slowLinkPage({ state: "ready" });
    await after(1_500);
    await after(1_500);
    expect(vi.mocked(mock.read).mock.calls.map(([request]) => request)).toEqual([
      { agentId: "assistente" },
      { agentId: "assistente" },
      { agentId: "assistente" },
    ]);
    vi.useRealTimers();
  });

  it("speaks the language of the app, and dictates in it", async () => {
    viewport(1280, 800);
    document.cookie = "NEXT_LOCALE=en; path=/";
    const { mock } = client({ state: "error", code: "status_failed" });
    const voice = voiceBridge();
    render(<DirectChatScreen client={mock} voiceInputBridge={voice.mock} />);

    expect(await screen.findByRole("region", { name: "Conversation with Captain" })).toBeInTheDocument();
    expect(screen.getByText("Direct chat")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Agent chats" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Writer" })).toBeInTheDocument();
    // The status is read asynchronously: the region is there from the first render, the error
    // (and its Retry button) only once `client.status()` has answered. A slow runner showed
    // «Securely connecting…» here, so the test waits for what it asserts.
    expect(await within(screen.getByTestId("direct-chat-status")).findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Write to Captain" })).toHaveAttribute("placeholder", "Connect the team to write");
    expect(await screen.findByRole("button", { name: "Dictate a message" })).toBeInTheDocument();
    expect(voice.mock.status).toHaveBeenCalledWith("en-US");
    expect(document.body).not.toHaveTextContent(/Capitano|Riprova|Invia|Chat diretta|Collega il team/);
  });

  it("closes the direct channel when the page unmounts", async () => {
    const { mock } = client();
    const view = render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    view.unmount();
    expect(mock.close).toHaveBeenCalledOnce();
  });
});

describe("DirectChatScreen: where the text goes, and when it is delivered", () => {
  it("says over the composer that the text goes to the agent's chat, not to its terminal", async () => {
    viewport(1280, 800);
    const { mock } = client();
    render(<DirectChatScreen client={mock} initialAgentId="mentor" embedded />);
    await screen.findByText("Messaggio dalla VPS");
    expect(screen.getByTestId("direct-chat-destination")).toHaveTextContent(
      "Destinazione: la chat di Mentor. Il testo gli arriva come messaggio, non come tasti nel suo terminale.",
    );
    expect(screen.getByTestId("direct-chat-keys")).toHaveTextContent("Invio manda · Ctrl+Invio va a capo");
  });

  it("says «Inviato» only once the receipt is back, and «Invio…» until then", async () => {
    viewport(1280, 800);
    const { mock } = client();
    let deliver: (receipt: DirectChatReceipt) => void = () => undefined;
    mock.send = vi.fn(({ clientMessageId }) => new Promise<DirectChatReceipt>((resolve) => {
      deliver = (receipt) => resolve({ ...receipt, clientMessageId });
    }));
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "Ci sei?{Enter}");
    const mine = (await screen.findByText("Ci sei?")).closest("article")!;
    expect(within(mine).getByTestId("direct-chat-in-flight")).toHaveTextContent("Invio…");
    expect(screen.queryByTestId("direct-chat-sent")).toBeNull();
    await act(async () => deliver({ clientMessageId: "", accepted: true, messageId: "remote-9", at: 3 }));
    await waitFor(() => expect(within(screen.getByText("Ci sei?").closest("article")!).getByTestId("direct-chat-sent")).toHaveTextContent("Inviato"));
    expect(screen.queryByTestId("direct-chat-in-flight")).toBeNull();
  });

  it("a turn that waits in the agent's mailbox is «In coda», never «Inviato»", async () => {
    viewport(1280, 800);
    const { mock } = client();
    mock.send = vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({
      clientMessageId,
      accepted: true,
      messageId: "remote-queued-1",
      at: 3,
      state: "queued",
    }));
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "Mi senti?{Enter}");
    const mine = (await screen.findByText("Mi senti?")).closest("article")!;
    await waitFor(() => expect(within(mine).getByTestId("direct-chat-queued")).toHaveTextContent("In coda"));
    expect(within(mine).queryByTestId("direct-chat-sent")).toBeNull();
    expect(mine).not.toHaveTextContent("Inviato");
    expect(screen.queryByTestId("direct-chat-in-flight")).toBeNull();
  });

  it("a receipt that carries no state is the typed turn: «Inviato»", async () => {
    viewport(1280, 800);
    const { mock } = client();
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "Ci sei?{Enter}");
    const mine = (await screen.findByText("Ci sei?")).closest("article")!;
    await waitFor(() => expect(within(mine).getByTestId("direct-chat-sent")).toHaveTextContent("Inviato"));
    expect(within(mine).queryByTestId("direct-chat-queued")).toBeNull();
  });

  it.each([
    ["it", "L'agente non ha ancora preso il messaggio."],
    ["en", "The agent has not taken your message yet."],
    ["de", "Der Agent hat deine Nachricht noch nicht abgeholt."],
    ["fr", "L'agent n'a pas encore pris ton message."],
    ["es", "El agente aún no ha tomado tu mensaje."],
    ["pt", "O agente ainda não apanhou a tua mensagem."],
    ["hu", "Az ügynök még nem vette át az üzenetedet."],
  ])("a system line with the code mail_not_taken is said in %s, not in the backend's English", async (locale, sentence) => {
    viewport(1280, 800);
    document.cookie = `NEXT_LOCALE=${locale}; path=/`;
    const { mock } = client();
    mock.read = vi.fn(async (): Promise<DirectChatPage> => ({
      messages: [
        { id: "u1", role: "user", text: "Ciao", at: 1 },
        { id: "nt-u1", role: "system", text: "The agent has not taken your message yet.", at: 2, code: "mail_not_taken" },
      ],
    }));
    render(<DirectChatScreen client={mock} />);
    const line = (await screen.findByText(sentence)).closest("article")!;
    expect(line).toHaveTextContent(sentence);
    if (locale !== "en") expect(screen.queryByText("The agent has not taken your message yet.")).toBeNull();
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])(
    "a system line whose code is the name of something every object has (%s) keeps its words and the chat stays alive",
    async (code) => {
      viewport(1280, 800);
      const { mock } = client();
      mock.read = vi.fn(async (): Promise<DirectChatPage> => ({
        messages: [
          { id: "s1", role: "system", text: "Words from the backend", at: 1, code },
          { id: "a1", role: "agent", text: "Still here", at: 2 },
        ],
      }));
      render(<DirectChatScreen client={mock} />);
      expect(await screen.findByText("Words from the backend")).toBeInTheDocument();
      expect(screen.getByText("Still here")).toBeInTheDocument();
    },
  );

  it("systemLineText finds only the catalog's own entries", () => {
    const codes = { mail_not_taken: "Frase" };
    const line = (code?: string) => ({ id: "s", role: "system" as const, text: "Testo", at: 1, code });
    expect(systemLineText(line("mail_not_taken"), codes)).toBe("Frase");
    for (const code of ["__proto__", "constructor", "toString", "x"]) expect(systemLineText(line(code), codes)).toBe("Testo");
    expect(systemLineText(line(undefined), codes)).toBe("Testo");
    expect(systemLineText({ ...line("mail_not_taken"), role: "agent" }, codes)).toBe("Testo");
  });

  it("renders the harmless emphasis from old auto-reports and drops all other HTML tags", () => {
    const { container } = render(<>{renderChatText('Auto-report <i>Captain</i> <script>ignored</script>')}</>);
    expect(container.querySelector("i")).toBeNull();
    expect(container.querySelector("em")).toHaveTextContent("Captain");
    expect(container).toHaveTextContent("Auto-report Captain ignored");
    expect(container.textContent).not.toContain("<script>");
  });

  it("groups consecutive automatic updates into one latest bubble with a count", () => {
    const messages = [
      { id: "u1", role: "agent" as const, text: "Captain update — Hi! I'm here", at: 1, kind: "info" as const },
      { id: "u2", role: "agent" as const, text: "Captain update — Hi! I'm here", at: 2, kind: "info" as const },
      { id: "u3", role: "agent" as const, text: "Captain update — Hi! I'm here", at: 3, kind: "info" as const },
      { id: "u4", role: "agent" as const, text: "Captain update — Hi! I'm here", at: 4, kind: "info" as const },
    ];
    const grouped = groupRepeatedMessages(messages.map((message) => ({ type: "message" as const, at: message.at, key: `m:${message.id}`, message })));
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ key: "m:u4", repeated: 4 });
  });

  it("keeps repeated updates apart when their suggested replies differ", () => {
    const messages = [
      { id: "u1", role: "agent" as const, text: "Captain update", at: 1, kind: "info" as const, suggestions: ["Read it", "Later"] },
      { id: "u2", role: "agent" as const, text: "Captain update", at: 2, kind: "info" as const, suggestions: ["Open details", "Later"] },
    ];
    const grouped = groupRepeatedMessages(messages.map((message) => ({ type: "message" as const, at: message.at, key: `m:${message.id}`, message })));
    expect(grouped).toHaveLength(2);
    expect(grouped.map((item) => item.type === "message" ? item.message.suggestions : [])).toEqual([
      ["Read it", "Later"],
      ["Open details", "Later"],
    ]);
  });

  it("a system line with a code the app does not know, or a code on another role, keeps the words it came with", async () => {
    viewport(1280, 800);
    const { mock } = client();
    mock.read = vi.fn(async (): Promise<DirectChatPage> => ({
      messages: [
        { id: "s1", role: "system", text: "Something the backend said", at: 1, code: "not_in_the_catalog" },
        { id: "a1", role: "agent", text: "I am the agent", at: 2, code: "mail_not_taken" },
      ],
    }));
    render(<DirectChatScreen client={mock} />);
    expect(await screen.findByText("Something the backend said")).toBeInTheDocument();
    expect(screen.getByText("I am the agent")).toBeInTheDocument();
    expect(screen.queryByText("L'agente non ha ancora preso il messaggio.")).toBeNull();
  });

  it("an agent away from its prompt: nothing is said delivered, the words go back to the composer, and the sentence says why", async () => {
    viewport(1280, 800);
    const { mock } = client();
    mock.send = vi.fn(async () => {
      throw { code: "agent_not_at_prompt" };
    });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "1{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("direct-chat-status")).toHaveTextContent(ERROR_CATALOG.agent_not_at_prompt.text.it),
    );
    expect(screen.getByTestId("direct-chat-status")).not.toHaveTextContent("agent_not_at_prompt");
    expect(screen.getByRole("textbox", { name: "Scrivi a Capitano" })).toHaveValue("1");
    expect(screen.queryByTestId("direct-chat-sent")).toBeNull();
    // the message the composer showed for a moment is gone from the transcript: it was never delivered
    expect(within(screen.getByTestId("direct-chat-transcript")).queryByText("Tu")).toBeNull();
  });

  it("Ctrl+Enter starts a new line and sends nothing; Enter sends the lines together", async () => {
    viewport(1280, 800);
    const { mock } = client();
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    const input = screen.getByRole("textbox", { name: "Scrivi a Capitano" });
    await user.type(input, "prima riga");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await user.type(input, "seconda riga");
    expect(input).toHaveValue("prima riga\nseconda riga");
    expect(mock.send).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ text: "prima riga\nseconda riga" })),
    );
  });

  it("Ctrl+Enter in the middle: what is typed next, at once, goes after the new line", async () => {
    viewport(1280, 800);
    const { mock } = client();
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    const input = screen.getByRole("textbox", { name: "Scrivi a Capitano" });
    await user.type(input, "abcd");
    // no wait between the keys: a person typing fast
    await user.keyboard("{ArrowLeft}{ArrowLeft}{Control>}{Enter}{/Control}XY");
    expect(input).toHaveValue("ab\nXYcd");
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("puts the new line where the cursor is, over a selection too", () => {
    expect(newLineAt("abcd", 2, 2)).toEqual({ value: "ab\ncd", cursor: 3 });
    expect(newLineAt("abcd", 1, 3)).toEqual({ value: "a\nd", cursor: 2 });
    expect(newLineAt("", 0, 0)).toEqual({ value: "\n", cursor: 1 });
  });
});
