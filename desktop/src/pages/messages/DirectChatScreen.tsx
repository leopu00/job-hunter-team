import { useEffect, useRef, useState } from "react";
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
    setOperationError(null);
    setLoading(false);
    if (status.state !== "ready") return;
    let active = true;
    let reading = false;

    async function readHistory(initial: boolean) {
      if (!active || reading) return;
      reading = true;
      if (initial) setLoading(true);
      try {
        // The native bridge returns the latest bounded page. Re-read it in full
        // and merge by id: its historical cursor skips the first appended line.
        const page = await client.read({ agentId });
        if (!active) return;
        setMessages((current) => mergeMessages(current, page));
        setOperationError(null);
      } catch (error) {
        if (active) setOperationError(errorCode(error) ?? "read_failed");
      } finally {
        reading = false;
        if (active && initial) setLoading(false);
      }
    }

    void readHistory(true);
    const interval = setInterval(() => void readHistory(false), HISTORY_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [agentId, client, status.state]);

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
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== id));
      setText(body);
      setOperationError(errorCode(error) ?? "send_failed");
    } finally {
      setSending(false);
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
                {message.text}
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
          <div
            className="mx-auto max-w-4xl flex flex-wrap items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 focus-within:border-[var(--color-border-glow)]"
            data-testid="direct-chat-composer-row"
          >
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
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
        </form>
      </section>
    </div>
  );
}
