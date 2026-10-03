import { useEffect, useMemo, useRef, useState } from "react";
import type { VoiceInputBridge } from "../../lib/voice-input";
import { VoiceInputControl } from "../../voice-input";
import type {
  DirectChatClient,
  DirectChatEvent,
  DirectChatMessage,
  DirectChatPage,
  DirectChatStatus,
} from "./direct-chat-contract";

const AGENTS = [
  { id: "capitano", label: "Capitano" },
  { id: "assistente", label: "Assistente" },
  { id: "mentor", label: "Mentor" },
  { id: "scout", label: "Scout" },
  { id: "analista", label: "Analista" },
  { id: "scorer", label: "Scorer" },
  { id: "scrittore", label: "Scrittore" },
  { id: "critico", label: "Critico" },
] as const;

export type DirectChatAgentId = (typeof AGENTS)[number]["id"];

export function isDirectChatAgentId(value: string | null): value is DirectChatAgentId {
  return AGENTS.some((agent) => agent.id === value);
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
  const failed = status.state === "error" || status.state === "disconnected";
  const code = safeCode(operationError ?? status.code);
  let text = "Connessione sicura al team…";
  if (status.state === "ready") text = "Team collegato";
  if (status.state === "disconnected") text = "Team non collegato.";
  if (status.state === "error") text = "Team non disponibile.";

  return (
    <div
      className="shrink-0 min-h-9 px-4 py-2 flex items-center justify-between gap-3 border-b border-[var(--color-border)] text-[10px]"
      role={failed || operationError ? "alert" : "status"}
      data-testid="direct-chat-status"
      style={{ color: failed || operationError ? "var(--color-red)" : "var(--color-muted)" }}
    >
      <span>
        {operationError ? "Operazione non riuscita." : text}
        {code ? ` Codice: ${code}.` : ""}
      </span>
      {(failed || operationError) && (
        <button
          type="button"
          onClick={onRetry}
          disabled={reconnecting}
          className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[10px] font-semibold text-[var(--color-bright)] disabled:opacity-50"
        >
          {reconnecting ? "Connessione…" : "Riprova"}
        </button>
      )}
    </div>
  );
}

export default function DirectChatScreen({
  client,
  voiceInputBridge,
  initialAgentId = "capitano",
}: {
  client: DirectChatClient;
  voiceInputBridge?: VoiceInputBridge;
  initialAgentId?: DirectChatAgentId;
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
  const selected = useMemo(() => AGENTS.find((agent) => agent.id === agentId)!, [agentId]);

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
        const snapshot = await client.status();
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
      try {
        void Promise.resolve(client.close()).catch(() => undefined);
      } catch {
        // The browser preview has no native bridge; unmount must stay quiet.
      }
    };
  }, [client]);

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
    if (!body || sending || status.state !== "ready") return;
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

  const canSend = status.state === "ready" && !sending && text.trim().length > 0;

  return (
    <div
      className="min-h-0 overflow-hidden flex flex-col md:flex-row bg-[var(--color-void)]"
      style={{ height: "calc(100svh / var(--zoom, 1) - 3.5rem)" }}
      data-testid="direct-chat-shell"
    >
      <aside className="hidden md:flex w-52 shrink-0 min-h-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="shrink-0 px-4 pt-4 pb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-dim)]">
          Agenti
        </div>
        <nav aria-label="Chat agenti" className="min-h-0 px-2 pb-3 grid content-start gap-1">
          {AGENTS.map((agent) => (
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

      <section className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col" aria-label={`Conversazione con ${selected.label}`}>
        <header className="shrink-0 min-h-14 px-4 sm:px-5 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
          <div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--color-dim)]">Chat diretta</div>
            <h1 className="m-0 text-[15px] font-bold tracking-wide text-[var(--color-white)]">{selected.label}</h1>
          </div>
          <label className="md:hidden text-[9px] uppercase tracking-wider text-[var(--color-dim)]">
            Agente
            <select
              aria-label="Agente"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value as typeof agentId)}
              className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-[11px] text-[var(--color-bright)]"
            >
              {AGENTS.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
            </select>
          </label>
        </header>

        <StatusBar status={status} operationError={operationError} reconnecting={reconnecting} onRetry={() => void retry()} />

        <div
          ref={transcript}
          role="log"
          aria-label={`Messaggi con ${selected.label}`}
          aria-live="polite"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5"
          data-testid="direct-chat-transcript"
        >
          <div className="mx-auto max-w-4xl flex flex-col gap-3">
            {loading && messages.length === 0 && (
              <p role="status" className="m-0 py-8 text-center text-[11px] text-[var(--color-muted)]">Carico la conversazione…</p>
            )}
            {!loading && messages.length === 0 && (
              <p className="m-0 py-8 text-center text-[11px] text-[var(--color-muted)]">Nessun messaggio. Puoi iniziare tu.</p>
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
                  {message.role === "user" ? "Tu" : message.role === "system" ? "Sistema" : selected.label}
                </div>
                {message.text}
              </article>
            ))}
          </div>
        </div>

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
              disabled={status.state !== "ready" || sending}
              aria-label={`Scrivi a ${selected.label}`}
              placeholder={status.state === "ready" ? `Scrivi a ${selected.label}…` : "Collega il team per scrivere"}
              className="max-h-28 min-h-8 w-full min-w-0 flex-[1_1_16rem] resize-none border-0 bg-transparent px-1 py-1.5 text-[12px] text-[var(--color-base)] outline-none disabled:opacity-50 sm:min-w-48"
            />
            <VoiceInputControl
              value={text}
              onChange={setText}
              locale="it-IT"
              bridge={voiceInputBridge}
              disabled={status.state !== "ready" || sending}
              className="w-full max-w-full sm:w-auto"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="h-8 shrink-0 self-end rounded-md bg-[var(--color-green)] px-4 text-[10px] font-bold text-[var(--color-void)] disabled:cursor-default disabled:opacity-40"
            >
              {sending ? "Invio…" : "Invia"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
