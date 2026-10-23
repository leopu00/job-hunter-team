import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import OwnVpsClaim from "../../components/OwnVpsClaim";
import { isOwnVpsClaimCode } from "../../lib/own-vps-claim";
import type { VoiceInputBridge } from "../../lib/voice-input";
import { VoiceInputControl } from "../../voice-input";
import type {
  DirectChatClient,
  DirectChatEvent,
  DirectChatMessage,
  DirectChatPage,
  DirectChatStatus,
} from "./direct-chat-contract";
import { DICTATION_LOCALE, DIRECT_CHAT_TEXT, withName } from "./direct-chat.i18n";

// The ids are the roles' keys on the VPS; the names come from the dictionary.
const AGENT_IDS = ["capitano", "assistente", "mentor", "scout", "analista", "scorer", "scrittore", "critico"] as const;

export type DirectChatAgentId = (typeof AGENT_IDS)[number];

export function isDirectChatAgentId(value: string | null): value is DirectChatAgentId {
  return AGENT_IDS.some((id) => id === value);
}

const INITIAL_STATUS: DirectChatStatus = { state: "connecting" };
const MAX_MESSAGE_LENGTH = 4_000;
const HISTORY_POLL_MS = 1_500;
// When every read is a new ssh connection (Windows to a VPS: no ControlMaster there), each read
// counts against the server's limits on new connections. So the page reads every 10 s, every 2 s for
// the 30 s after the person sends, not at all while the window is hidden or not focused (one read
// as soon as it is back), and after `ssh_rate_limited` it waits twice as long each time, up to 60 s,
// until a read gets through.
const SLOW_LINK_IDLE_MS = 10_000;
const SLOW_LINK_AFTER_SEND_MS = 2_000;
const AFTER_SEND_FAST_MS = 30_000;
const RATE_LIMITED_MAX_MS = 60_000;

function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_-]{1,48}$/i.test(value)
    ? value
    : null;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  return safeCode((error as { code?: unknown }).code);
}

function mergeMessages(
  current: DirectChatMessage[],
  page: DirectChatPage,
): DirectChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of page.messages) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => left.at - right.at);
}

/**
 * Ctrl+Enter starts a new line where the cursor is (a textarea does not do it by itself); Enter
 * alone sends, and Shift+Enter keeps the textarea's own new line.
 */
export function newLineAt(value: string, start: number, end: number): { value: string; cursor: number } {
  return { value: `${value.slice(0, start)}\n${value.slice(end)}`, cursor: start + 1 };
}

/**
 * What a system line says: its closed code in the person's language when the catalog has that code as
 * its OWN entry, else the words it came with. `codes` is a plain object, so a code that is the name of
 * something every object has (`__proto__`, `constructor`) must not find it.
 */
export function systemLineText(message: DirectChatMessage, codes: Record<string, string>): string {
  const code = message.role === "system" ? message.code : undefined;
  if (code && Object.prototype.hasOwnProperty.call(codes, code) && typeof codes[code] === "string") {
    return codes[code];
  }
  return message.text;
}

function clientMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function StatusBar({
  status,
  operationError,
  reconnecting,
  onRetry,
}: {
  status: DirectChatStatus;
  operationError: string | null;
  reconnecting: boolean;
  onRetry: () => void;
}) {
  const locale = appLocale();
  const t = DIRECT_CHAT_TEXT[locale];
  const failed = status.state === "error" || status.state === "disconnected";
  const code = safeCode(operationError ?? status.code);
  let text = t.connecting;
  if (status.state === "ready") text = t.connected;
  if (status.state === "disconnected") text = t.disconnected;
  if (status.state === "error") text = t.unavailable;
  if (operationError) text = t.operationFailed;
  // A code the catalog knows is told with its sentence and action; the raw
  // code is never shown.
  const described = (failed || operationError) && code ? describeError(code, { locale }) : null;
  if (described?.known) text = `${described.text} ${described.action}`;

  return (
    <div
      className="shrink-0 min-h-9 px-4 py-2 flex items-center justify-between gap-3 border-b border-[var(--color-border)] text-[10px]"
      role={failed || operationError ? "alert" : "status"}
      data-testid="direct-chat-status"
      style={{ color: failed || operationError ? "var(--color-red)" : "var(--color-muted)" }}
    >
      <span>
        {text}
      </span>
      {(failed || operationError) && (
        <button
          type="button"
          onClick={onRetry}
          disabled={reconnecting}
          className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[10px] font-semibold text-[var(--color-bright)] disabled:opacity-50"
        >
          {reconnecting ? t.reconnecting : t.retry}
        </button>
      )}
    </div>
  );
}

export default function DirectChatScreen({
  client,
  voiceInputBridge,
  initialAgentId = "capitano",
  embedded = false,
  writeLocked = false,
  onConnect,
}: {
  client: DirectChatClient;
  voiceInputBridge?: VoiceInputBridge;
  initialAgentId?: DirectChatAgentId;
  /**
   * One agent, inside another page (the Chat tab of the Agents page): no list of agents, no title,
   * the connection stays open when the pane goes away, and a connection that fell is opened again.
   */
  embedded?: boolean;
  /** The read-only view: history and answers are shown, the composer says why it cannot write. */
  writeLocked?: boolean;
  /** With `writeLocked`: where the invitation's button goes (the way to the full connection). */
  onConnect?: () => void;
}) {
  const [agentId, setAgentId] = useState<DirectChatAgentId>(initialAgentId);
  const [status, setStatus] = useState<DirectChatStatus>(INITIAL_STATUS);
  const [messages, setMessages] = useState<DirectChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  // The person's messages of this view that the agent's CLI took: only a receipt says so.
  const [delivered, setDelivered] = useState<ReadonlySet<string>>(() => new Set());
  // A receipt that says `queued`: the turn is in the agent's mailbox, and nobody has said it was taken.
  const [queued, setQueued] = useState<ReadonlySet<string>>(() => new Set());
  const [inFlight, setInFlight] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const slowLink = status.state === "ready" && status.link === "per-command";
  const lastSentAt = useRef(0);
  // Set by the reading loop: the next read comes soon after a send, not up to 5 s later.
  const readSoon = useRef<(() => void) | null>(null);
  // Where the cursor goes once the new line is in the box: set in the same commit, before the next
  // key is read, so a person typing fast keeps writing after the new line, not before it.
  const cursorAfterNewLine = useRef<number | null>(null);
  useLayoutEffect(() => {
    const cursor = cursorAfterNewLine.current;
    if (cursor === null) return;
    cursorAfterNewLine.current = null;
    composer.current?.setSelectionRange(cursor, cursor);
  }, [text]);
  const transcript = useRef<HTMLDivElement>(null);
  const currentAgent = useRef(agentId);
  currentAgent.current = agentId;
  const locale = appLocale();
  const t = DIRECT_CHAT_TEXT[locale];
  const agents = AGENT_IDS.map((id) => ({ id, label: t.agents[id] }));
  const selected = agents.find((agent) => agent.id === agentId)!;

  useEffect(() => {
    setAgentId(initialAgentId);
  }, [initialAgentId]);

  useEffect(() => {
    let active = true;
    const onEvent = (event: DirectChatEvent) => {
      if (!active) return;
      if (event.kind === "status") {
        setStatus(event.status);
        if (event.status.state === "ready") setOperationError(null);
      } else if (event.kind === "messages" && event.agentId === currentAgent.current) {
        setMessages((current) => mergeMessages(current, event.page));
      } else if (event.kind === "error") {
        setOperationError(safeCode(event.code) ?? "unknown");
      }
    };

    void (async () => {
      try {
        let snapshot = await client.status();
        // An embedded pane may open after the connection was closed (leaving the Messages page
        // closes it): the saved host is enough to open it again, with no question to the person.
        if (embedded && active && snapshot.state === "disconnected") {
          setStatus({ state: "connecting" });
          snapshot = await client.reconnect();
        }
        if (active) setStatus(snapshot);
      } catch (error) {
        if (active) setStatus({ state: "error", code: errorCode(error) ?? "status_failed" });
      }
      try {
        const subscribed = await client.subscribe({ onEvent });
        if (active) setStatus(subscribed);
      } catch (error) {
        if (active) setStatus({ state: "error", code: errorCode(error) ?? "subscribe_failed" });
      }
    })();

    return () => {
      active = false;
      // An embedded pane shares the connection with the page around it: closing it here would cut
      // the chat of every other tab.
      if (embedded) return;
      try {
        void Promise.resolve(client.close()).catch(() => undefined);
      } catch {
        // The browser preview has no native bridge; unmount must stay quiet.
      }
    };
  }, [client, embedded]);

  useEffect(() => {
    setMessages([]);
    setDelivered(new Set());
    setQueued(new Set());
    setOperationError(null);
    setLoading(false);
    if (status.state !== "ready") return;
    let active = true;
    let reading = false;

    // The failure code of the read, null when it got through, undefined when it did not run.
    async function readHistory(initial: boolean): Promise<string | null | undefined> {
      if (!active || reading) return undefined;
      reading = true;
      if (initial) setLoading(true);
      try {
        // The native bridge returns the latest bounded page. Re-read it in full
        // and merge by id: its historical cursor skips the first appended line.
        const page = await client.read({ agentId });
        if (!active) return undefined;
        setMessages((current) => mergeMessages(current, page));
        setOperationError(null);
        return null;
      } catch (error) {
        const code = errorCode(error) ?? "read_failed";
        if (active) setOperationError(code);
        return code;
      } finally {
        reading = false;
        if (active && initial) setLoading(false);
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Slow link only: the wait after ssh_rate_limited (0: none), and whether the window can be seen.
    let backoff = 0;
    let visible = document.visibilityState !== "hidden";
    let focused = true;
    let waitingForWindow = false;
    const paused = () => slowLink && !(visible && focused);
    const pace = () => {
      if (!slowLink) return HISTORY_POLL_MS;
      return Date.now() - lastSentAt.current > AFTER_SEND_FAST_MS ? SLOW_LINK_IDLE_MS : SLOW_LINK_AFTER_SEND_MS;
    };
    const delay = () => (slowLink && backoff ? backoff : pace());
    const tick = async () => {
      if (paused()) {
        waitingForWindow = true;
        return;
      }
      settle(await readHistory(false));
    };
    // After a read: the next one at the pace, or later and later while the server turns this computer away:
    // 20, 40, then 60 s, from the idle pace even right after a send.
    const settle = (failed: string | null | undefined) => {
      if (!active) return;
      if (slowLink && failed !== undefined) {
        backoff = failed === "ssh_rate_limited" ? Math.min(RATE_LIMITED_MAX_MS, (backoff || SLOW_LINK_IDLE_MS) * 2) : failed ? backoff : 0;
      }
      schedule(delay());
    };
    const schedule = (after: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), after);
    };
    const windowChanged = () => {
      visible = document.visibilityState !== "hidden";
      if (waitingForWindow && !paused()) {
        waitingForWindow = false;
        // back in view: a read now, unless the server is turning this computer away
        schedule(backoff ? backoff : 0);
      }
    };
    const onFocus = () => {
      focused = true;
      windowChanged();
    };
    const onBlur = () => {
      focused = false;
    };
    document.addEventListener("visibilitychange", windowChanged);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    readSoon.current = () => schedule(delay());
    schedule(delay());
    // the first read keeps the pace set at mount; only a refused one pushes the next read back
    void readHistory(true).then((failed) => {
      if (slowLink && failed === "ssh_rate_limited") settle(failed);
    });
    return () => {
      active = false;
      readSoon.current = null;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", windowChanged);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [agentId, client, status.state, slowLink]);

  useEffect(() => {
    const node = transcript.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, agentId]);

  async function retry() {
    setReconnecting(true);
    setOperationError(null);
    setStatus({ state: "connecting" });
    try {
      setStatus(await client.reconnect());
    } catch (error) {
      setStatus({ state: "error", code: errorCode(error) ?? "reconnect_failed" });
    } finally {
      setReconnecting(false);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || sending || writeLocked || status.state !== "ready") return;
    const id = clientMessageId();
    const optimistic: DirectChatMessage = { id, role: "user", text: body, at: Date.now() };
    setText("");
    setSending(true);
    setInFlight(id);
    lastSentAt.current = Date.now();
    readSoon.current?.();
    setOperationError(null);
    setMessages((current) => mergeMessages(current, { messages: [optimistic] }));
    try {
      const receipt = await client.send({ agentId, text: body, clientMessageId: id });
      setMessages((current) =>
        current.map((message) =>
          message.id === receipt.clientMessageId
            ? { ...message, id: receipt.messageId, at: receipt.at }
            : message,
        ),
      );
      if (receipt.state === "queued") setQueued((current) => new Set(current).add(receipt.messageId));
      else setDelivered((current) => new Set(current).add(receipt.messageId));
    } catch (error) {
      // Not delivered: the words go back to the composer, and the status bar says why.
      setMessages((current) => current.filter((message) => message.id !== id));
      setText(body);
      setOperationError(errorCode(error) ?? "send_failed");
    } finally {
      setSending(false);
      setInFlight(null);
    }
  }

  const canSend = status.state === "ready" && !writeLocked && !sending && text.trim().length > 0;
  const composerOff = status.state !== "ready" || sending || writeLocked;

  return (
    <div
      className="min-h-0 overflow-hidden flex flex-col md:flex-row bg-[var(--color-void)]"
      style={embedded ? { height: "100%" } : { height: "calc(100svh / var(--zoom, 1) - 3.5rem)" }}
      data-testid="direct-chat-shell"
    >
      {!embedded && (
      <aside className="hidden md:flex w-52 shrink-0 min-h-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="shrink-0 px-4 pt-4 pb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-dim)]">
          {t.agentsHeading}
        </div>
        <nav aria-label={t.agentsNavAria} className="min-h-0 px-2 pb-3 grid content-start gap-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              aria-current={agent.id === agentId ? "page" : undefined}
              onClick={() => setAgentId(agent.id)}
              className="min-h-9 rounded px-3 py-2 text-left text-[11px] font-semibold transition-colors"
              style={{
                color: agent.id === agentId ? "var(--color-green)" : "var(--color-muted)",
                background: agent.id === agentId ? "var(--color-card)" : "transparent",
              }}
            >
              {agent.label}
            </button>
          ))}
        </nav>
      </aside>
      )}

      <section className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col" aria-label={withName(t.conversationWith, selected.label)}>
        {!embedded && (
        <header className="shrink-0 min-h-14 px-4 sm:px-5 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
          <div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--color-dim)]">{t.title}</div>
            <h1 className="m-0 text-[15px] font-bold tracking-wide text-[var(--color-white)]">{selected.label}</h1>
          </div>
          <label className="md:hidden text-[9px] uppercase tracking-wider text-[var(--color-dim)]">
            {t.agentSelect}
            <select
              aria-label={t.agentSelect}
              value={agentId}
              onChange={(event) => setAgentId(event.target.value as typeof agentId)}
              className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-[11px] text-[var(--color-bright)]"
            >
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
            </select>
          </label>
        </header>
        )}

        <StatusBar status={status} operationError={operationError} reconnecting={reconnecting} onRetry={() => void retry()} />
        {!writeLocked && isOwnVpsClaimCode(operationError) && (
          <div className="shrink-0 px-4 pt-3">
            <OwnVpsClaim reason={operationError} onClaimed={() => setOperationError(null)} />
          </div>
        )}

        <div
          ref={transcript}
          role="log"
          aria-label={withName(t.messagesWith, selected.label)}
          aria-live="polite"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5"
          data-testid="direct-chat-transcript"
        >
          <div className="mx-auto max-w-4xl flex flex-col gap-3">
            {loading && messages.length === 0 && (
              <p role="status" className="m-0 py-8 text-center text-[11px] text-[var(--color-muted)]">{t.loadingConversation}</p>
            )}
            {!loading && messages.length === 0 && (
              <p className="m-0 py-8 text-center text-[11px] text-[var(--color-muted)]">{t.empty}</p>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[86%] rounded-lg px-4 py-3 text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
                  message.role === "user" ? "self-end rounded-br-sm" : "self-start rounded-bl-sm"
                }`}
                style={{
                  color: "var(--color-base)",
                  background:
                    message.role === "user"
                      ? "color-mix(in srgb, var(--color-green) 10%, var(--color-card))"
                      : "var(--color-card)",
                  border: `1px solid ${message.role === "system" ? "var(--color-yellow)" : "var(--color-border)"}`,
                }}
              >
                <div className="mb-1 text-[8px] font-semibold uppercase tracking-wider text-[var(--color-dim)]">
                  {message.role === "user" ? t.you : message.role === "system" ? t.system : selected.label}
                </div>
                {systemLineText(message, t.codes)}
                {message.role === "user" && (message.id === inFlight || queued.has(message.id) || delivered.has(message.id)) && (
                  <div
                    data-testid={
                      message.id === inFlight
                        ? "direct-chat-in-flight"
                        : queued.has(message.id)
                          ? "direct-chat-queued"
                          : "direct-chat-delivered"
                    }
                    className="mt-1 text-right text-[11px] text-[var(--color-muted)]"
                  >
                    {message.id === inFlight ? t.sending : queued.has(message.id) ? t.queued : t.delivered}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        {writeLocked && (
          <p
            role="note"
            data-testid="direct-chat-read-only-invite"
            className="shrink-0 m-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 sm:px-6 py-2 text-[11px] text-[var(--color-muted)] flex flex-wrap items-center gap-3"
          >
            <span>{t.readOnlyInvite}</span>
            {onConnect && (
              <button
                type="button"
                onClick={onConnect}
                className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[10px] font-semibold text-[var(--color-bright)]"
              >
                {t.readOnlyConnect}
              </button>
            )}
          </p>
        )}
        <form
          className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 sm:px-6 py-3"
          data-testid="direct-chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <p
            data-testid="direct-chat-destination"
            className="mx-auto max-w-4xl m-0 mb-1.5 text-[11px] text-[var(--color-muted)]"
          >
            {withName(t.destination, selected.label)}
          </p>
          <div
            className="mx-auto max-w-4xl flex flex-wrap items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 focus-within:border-[var(--color-border-glow)]"
            data-testid="direct-chat-composer-row"
          >
            <textarea
              ref={composer}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.ctrlKey) {
                  event.preventDefault();
                  const node = event.currentTarget;
                  const next = newLineAt(text, node.selectionStart, node.selectionEnd);
                  cursorAfterNewLine.current = next.cursor;
                  setText(next.value);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH}
              disabled={composerOff}
              aria-label={withName(t.writeTo, selected.label)}
              placeholder={
                writeLocked
                  ? t.readOnlyInvite
                  : status.state === "ready" ? withName(t.writeToPlaceholder, selected.label) : t.connectToWrite
              }
              className="max-h-28 min-h-8 w-full min-w-0 flex-[1_1_16rem] resize-none border-0 bg-transparent px-1 py-1.5 text-[12px] text-[var(--color-base)] outline-none disabled:opacity-50 sm:min-w-48"
            />
            <VoiceInputControl
              value={text}
              onChange={setText}
              locale={DICTATION_LOCALE[locale]}
              bridge={voiceInputBridge}
              disabled={composerOff}
              className="w-full max-w-full sm:w-auto"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="h-8 shrink-0 self-end rounded-md bg-[var(--color-green)] px-4 text-[10px] font-bold text-[var(--color-void)] disabled:cursor-default disabled:opacity-40"
            >
              {sending ? t.sending : t.send}
            </button>
          </div>
          <p data-testid="direct-chat-keys" className="mx-auto max-w-4xl m-0 mt-1 text-[11px] text-[var(--color-dim)]">
            {t.keysHint}
          </p>
        </form>
      </section>
    </div>
  );
}
