import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import OwnVpsClaim from "../../components/OwnVpsClaim";
import { isOwnVpsClaimCode } from "../../lib/own-vps-claim";
import type { VoiceInputBridge } from "../../lib/voice-input";
import { VoiceInputControl } from "../../voice-input";
import type {
  DirectChatAnswer,
  DirectChatClient,
  DirectChatEvent,
  DirectChatMessage,
  DirectChatPage,
  DirectChatQuestion,
  DirectChatStatus,
} from "./direct-chat-contract";
import { DICTATION_LOCALE, DIRECT_CHAT_TEXT, withName } from "./direct-chat.i18n";
import ChatQuestion from "./ChatQuestion";
import {
  cleanMessage,
  dayKey,
  dayLabel,
  ENTER_AGAIN_MAX,
  excerpt,
  fullStamp,
  KIND_COLOR,
  outcomeOf,
  questionsOf,
  quoteLine,
  settleQueued,
  timeLabel,
  transcript as conversationItems,
  type Outcome,
} from "./chat-kinds";
import { sameAsBefore } from "./same-as-before";
import { renderChatMarkdown, renderChatText } from "./chat-text";
import { JumpToLatest, useStickToBottom } from "./stick-to-bottom";

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
  for (const message of page.messages) byId.set(message.id, cleanMessage(message));
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

export { renderChatText };

type ConversationItem = ReturnType<typeof conversationItems>[number];
type GroupedConversationItem = ConversationItem & { repeated?: number };

/** Two bubbles are interchangeable only when they keep the same clickable replies too. */
function sameSuggestions(left: DirectChatMessage, right: DirectChatMessage): boolean {
  const leftLines = left.suggestions ?? [];
  const rightLines = right.suggestions ?? [];
  return leftLines.length === rightLines.length && leftLines.every((line, index) => line === rightLines[index]);
}

/** A run of identical automatic updates is one readable bubble with its count. */
export function groupRepeatedMessages(items: ConversationItem[]): GroupedConversationItem[] {
  const grouped: GroupedConversationItem[] = [];
  for (const item of items) {
    const previous = grouped.at(-1);
    const sameMessage =
      item.type === "message" &&
      previous?.type === "message" &&
      item.message.role !== "user" &&
      previous.message.role === item.message.role &&
      item.message.text === previous.message.text &&
      item.message.kind === previous.message.kind &&
      sameSuggestions(previous.message, item.message) &&
      dayKey(item.at) === dayKey(previous.at);
    if (sameMessage) {
      grouped[grouped.length - 1] = { ...item, repeated: (previous.repeated ?? 1) + 1 };
    } else {
      grouped.push(item);
    }
  }
  return grouped;
}

function clientMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** How long «connecting» may last before the bar says so and offers the retry (never a silent wait). */
const CONNECTING_SLOW_MS = 8_000;
// An embedded pane opens a connection that was closed by itself. The first time the team has just come
// up, so the first attempt can meet it not ready yet: it asks again, a little later each time, before
// it tells the person anything.
const REOPEN_TRIES = 3;
const REOPEN_WAIT_MS = 1_500;
// What asking again cannot change, or makes worse (a server that counts failed sign-ins or turns the
// computer away): these are told at once, with their Retry. Anything else is a team not ready yet.
const REOPEN_NO_RETRY = new Set([
  "ssh_auth_failed",
  "ssh_rate_limited",
  "host_key_changed",
  "host_key_mismatch",
  "ssh_client_missing",
  "own_vps_key_changed",
  "own_vps_claim_refused",
  "account_scope_mismatch",
  "read_only_link",
  "existing_team_runtime_target_changed",
]);

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
  const [slow, setSlow] = useState(false);
  const connecting = status.state === "connecting";
  useEffect(() => {
    setSlow(false);
    if (!connecting) return;
    const timer = setTimeout(() => setSlow(true), CONNECTING_SLOW_MS);
    return () => clearTimeout(timer);
  }, [connecting]);
  const stuck = connecting && slow && !reconnecting;
  const failed = status.state === "error" || status.state === "disconnected" || stuck;
  const code = safeCode(operationError ?? status.code);
  let text = stuck ? t.connectingSlow : t.connecting;
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
      className="shrink-0 min-h-9 px-4 py-2 flex items-center justify-between gap-3 border-b border-[var(--color-border)] text-[12px]"
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
          className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[12px] font-semibold text-[var(--color-bright)] disabled:opacity-50"
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
  // The agent's questions: each read brings the open ones and the latest closed ones, whole.
  const [questions, setQuestions] = useState<DirectChatQuestion[]>([]);
  // Whether the team's image brings the questions at all: an older one cannot take an answer either.
  const [questionsHere, setQuestionsHere] = useState(false);
  // Answers that went and that no read has shown closed yet: the question stays closed meanwhile,
  // so a read that comes in between does not offer the buttons again.
  const [answersInFlight, setAnswersInFlight] = useState<ReadonlyMap<string, DirectChatAnswer>>(() => new Map());
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  // Where the error on the bar came from: the connection (a «ready» that follows ends it) or a read or a
  // send that failed (it stays on the bar until a later read or send gets through, whatever the status says).
  const connectionError = useRef(false);
  const failOperation = (code: string) => {
    connectionError.current = false;
    setOperationError(code);
  };
  // Why an answer written in the composer did not go: it stays in the box.
  const [answerRefusal, setAnswerRefusal] = useState<string | null>(null);
  // What the receipt said of each message of the person's in this view; only a receipt says it.
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(() => new Map());
  // A message whose Enter is being pressed again.
  const [pressing, setPressing] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<string | null>(null);
  // What the composer replies to, chosen by the person (right-click → Reply): nothing until then.
  // An open question that takes words: what is written is its answer. Anything else: a quote.
  const [replyTo, setReplyTo] = useState<{ kind: "message" | "question"; id: string } | null>(null);
  // The right-click menu of a message or a question: where, and for which.
  const [menu, setMenu] = useState<{ kind: "message" | "question"; id: string; x: number; y: number } | null>(null);
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
        if (event.status.state === "ready" && connectionError.current) {
          connectionError.current = false;
          setOperationError(null);
        }
      } else if (event.kind === "messages" && event.agentId === currentAgent.current) {
        setMessages((current) => sameAsBefore(current, mergeMessages(current, event.page)));
        if (Array.isArray(event.page.questions)) {
          setQuestionsHere(true);
          setQuestions((current) => sameAsBefore(current, questionsOf(event.page)));
        }
      } else if (event.kind === "error") {
        // The native side says which operation failed: a «ready» ends a failed connection or stream only.
        connectionError.current = event.operation === "connect" || event.operation === "stream";
        setOperationError(safeCode(event.code) ?? "unknown");
      }
    };

    void (async () => {
      // Set when the opening below failed for good: the status the native side gives afterwards is
      // «disconnected» (nothing is open), and it must not cover the reason on the bar.
      let openingFailed = false;
      try {
        let snapshot = await client.status();
        // An embedded pane may open after the connection was closed (leaving the Messages page
        // closes it): the saved host is enough to open it again, with no question to the person.
        for (let attempt = 1; embedded && active && snapshot.state === "disconnected"; attempt += 1) {
          setStatus({ state: "connecting" });
          try {
            snapshot = await client.reconnect();
            break;
          } catch (error) {
            const code = errorCode(error);
            if (attempt >= REOPEN_TRIES || (code !== null && REOPEN_NO_RETRY.has(code))) throw error;
            await new Promise((resolve) => setTimeout(resolve, REOPEN_WAIT_MS * attempt));
            if (!active) return;
            // Someone else may have opened it meanwhile (another tab of the same chat).
            snapshot = await client.status();
          }
        }
        if (active) setStatus(snapshot);
      } catch (error) {
        openingFailed = true;
        if (active) setStatus({ state: "error", code: errorCode(error) ?? "status_failed" });
      }
      try {
        const subscribed = await client.subscribe({ onEvent });
        if (active && !(openingFailed && subscribed.state === "disconnected")) setStatus(subscribed);
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
    setQuestions([]);
    setQuestionsHere(false);
    setAnswersInFlight(new Map());
    setReplyTo(null);
    setMenu(null);
    setOutcomes(new Map());
    setPressing(null);
    setOperationError(null);
    setLoading(false);
    if (status.state !== "ready") return;
    let active = true;
    let reading = false;
    // Slow link only: where the last read ended. The native side reads from a little before it, so
    // a read carries the new lines and not the whole tail of the chat at every connection.
    let cursor: string | undefined;

    // The failure code of the read, null when it got through, undefined when it did not run.
    async function readHistory(initial: boolean): Promise<string | null | undefined> {
      if (!active || reading) return undefined;
      reading = true;
      if (initial) setLoading(true);
      try {
        // The native bridge returns the latest bounded page. Re-read it in full
        // and merge by id: its historical cursor skips the first appended line. On a slow
        // link the cursor goes back, and the native side reads from before it.
        const page = await client.read(slowLink && cursor ? { agentId, cursor } : { agentId });
        if (!active) return undefined;
        if (slowLink) cursor = page.cursor;
        setMessages((current) => sameAsBefore(current, mergeMessages(current, page)));
        // a turn the team held back while its agent worked takes the ending the page reports for it
        if (Array.isArray(page.settled)) setOutcomes((current) => settleQueued(current, page.settled));
        // a page that brings the questions replaces them; one without the field (an older image)
        // leaves the chat without answers
        if (Array.isArray(page.questions)) {
          setQuestionsHere(true);
          setQuestions((current) => sameAsBefore(current, questionsOf(page)));
        }
        setOperationError(null);
        return null;
      } catch (error) {
        const code = errorCode(error) ?? "read_failed";
        if (active) failOperation(code);
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

  // a read closed a question the person answered here: its own account replaces the local one
  useEffect(() => {
    setAnswersInFlight((current) => {
      if (current.size === 0) return current;
      const next = new Map(current);
      for (const question of questions) if (question.state !== "open") next.delete(question.id);
      return next.size === current.size ? current : next;
    });
  }, [questions]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

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

  // `suggested`: a reply the agent suggested, sent as it is (the composer keeps what was typed).
  async function send(suggested?: string) {
    const typed = (suggested ?? text).trim();
    if (!typed || sending || writeLocked || status.state !== "ready") return;
    const target = suggested === undefined ? replyTarget() : null;
    if (target?.kind === "question" && target.words) {
      // the words are the answer to the open question, not a message in the agent's terminal
      setSending(true);
      setOperationError(null);
      const refusal = await answer(target.question.id, [], typed);
      setSending(false);
      if (refusal === null) {
        setText("");
        setReplyTo(null);
      } else {
        setAnswerRefusal(`${refusal} ${t.answerTextKept}`);
      }
      return;
    }
    const body = target ? `${quoteLine(t.quotePrefix, target.text)}\n${typed}` : typed;
    if (suggested === undefined) setReplyTo(null);
    setAnswerRefusal(null);
    const id = clientMessageId();
    // in seconds, as the team's times: the receipt's time replaces it
    const optimistic: DirectChatMessage = { id, role: "user", text: body, at: Date.now() / 1000 };
    if (suggested === undefined) setText("");
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
      setOutcomes((current) => new Map(current).set(receipt.messageId, outcomeOf(receipt, 0)));
    } catch (error) {
      // Not delivered: the words go back to the composer, and the status bar says why.
      setMessages((current) => current.filter((message) => message.id !== id));
      // what was typed goes back to the composer; a suggestion leaves the composer as it is
      if (suggested === undefined) setText(typed);
      failOperation(errorCode(error) ?? "send_failed");
    } finally {
      setSending(false);
      setInFlight(null);
    }
  }

  // Enter once more on a text left in the agent's composer: never the text, and only a few times.
  async function enterAgain(messageId: string) {
    const before = outcomes.get(messageId);
    if (!client.enter || pressing || before?.kind !== "notSent" || before.presses >= ENTER_AGAIN_MAX) return;
    if (writeLocked || status.state !== "ready") return;
    setPressing(messageId);
    setOperationError(null);
    try {
      const receipt = await client.enter({ agentId, messageId });
      setOutcomes((current) => new Map(current).set(messageId, outcomeOf(receipt, before.presses + 1)));
    } catch (error) {
      failOperation(errorCode(error) ?? "send_failed");
    } finally {
      setPressing(null);
    }
  }

  // The answer to one of the agent's questions: the question closes with the choice as soon as the
  // team took it; the next read brings the team's own account of it.
  async function answer(questionId: string, choices: string[], words: string | null): Promise<string | null> {
    if (!canAnswer || !client.answer) return t.answerErrors.answer_failed;
    try {
      const receipt = await client.answer({ agentId, questionId, choices, text: words });
      setAnswersInFlight((current) =>
        new Map(current).set(questionId, { choices, ...(words ? { text: words } : {}), at: receipt.at, origin: "user", seenAt: null }),
      );
      readSoon.current?.();
      return null;
    } catch (error) {
      const code = errorCode(error);
      // answered elsewhere: the next read brings the team's account of it
      if (code === "question_closed") readSoon.current?.();
      if (code && Object.prototype.hasOwnProperty.call(t.answerErrors, code)) {
        return t.answerErrors[code as keyof typeof t.answerErrors];
      }
      // why the chat could not take it (an older image, the read-only link, a fallen connection): the
      // status bar says it with the app's sentence, the card that the answer did not go
      if (code) failOperation(code);
      return t.answerErrors.answer_failed;
    }
  }


  const canAnswer = status.state === "ready" && !writeLocked && questionsHere && typeof client.answer === "function";
  const shownQuestions = questions.map((question) => {
    const local = question.state === "open" ? answersInFlight.get(question.id) : undefined;
    return local ? { ...question, state: "answered" as const, answer: local } : question;
  });
  const items = groupRepeatedMessages(conversationItems(messages, shownQuestions));

  // What the composer replies to now: gone from the view, it is nothing; an open question that
  // takes words is answered with them; a closed one, or a message, is quoted.
  function replyTarget():
    | { kind: "question"; question: DirectChatQuestion; words: boolean; text: string }
    | { kind: "message"; text: string }
    | null {
    if (!replyTo) return null;
    if (replyTo.kind === "question") {
      const question = shownQuestions.find((q) => q.id === replyTo.id);
      if (!question) return null;
      return { kind: "question", question, words: question.state === "open" && question.free && canAnswer, text: question.subject || question.text };
    }
    const message = messages.find((m) => m.id === replyTo.id);
    return message ? { kind: "message", text: message.text } : null;
  }
  const target = replyTarget();

  function openMenu(kind: "message" | "question", id: string, event: { preventDefault(): void; clientX: number; clientY: number }) {
    if (writeLocked) return;
    event.preventDefault();
    setMenu({ kind, id, x: event.clientX, y: event.clientY });
  }

  function replyFromMenu(kind: "message" | "question", id: string) {
    setMenu(null);
    setReplyTo({ kind, id });
    setAnswerRefusal(null);
    // the person writes next: the cursor goes in the box
    composer.current?.focus();
  }
  const lastItem = items.length > 0 ? items[items.length - 1].key : null;
  const bottom = useStickToBottom({ conversation: agentId, last: lastItem, count: items.length });

  function renderMessage(message: DirectChatMessage, key: string, repeated?: number) {
    return (
      <article
        key={key}
        className={`max-w-[min(92%,72rem)] rounded-lg px-4 py-3 text-[15px] leading-[1.7] break-words ${
          message.role === "user" ? "self-end rounded-br-sm" : "self-start rounded-bl-sm"
        }`}
        style={{
          color: "var(--color-base)",
          background:
            message.role === "user"
              ? "color-mix(in srgb, var(--color-green) 10%, var(--color-card))"
              : "var(--color-card)",
          border: `1px solid ${
            message.role === "system"
              ? "var(--color-yellow)"
              : replyTo?.kind === "message" && replyTo.id === message.id
                ? "var(--color-border-glow)"
                : "var(--color-border)"
          }`,
          // urgent and blocked: a bar on the left, not the whole border
          boxShadow: message.role === "agent" && KIND_COLOR[message.kind ?? "info"] ? `inset 3px 0 0 ${KIND_COLOR[message.kind ?? "info"]}` : undefined,
        }}
        data-quoted={replyTo?.kind === "message" && replyTo.id === message.id ? "true" : undefined}
        onContextMenu={message.role === "system" ? undefined : (event) => openMenu("message", message.id, event)}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-dim)]">
          <span>{message.role === "user" ? t.you : message.role === "system" ? t.system : selected.label}</span>
          {repeated && repeated > 1 && <span data-testid="direct-chat-repeat">×{repeated}</span>}
          {message.role === "agent" && (
            <span data-testid="direct-chat-kind" data-kind={message.kind ?? "info"} style={{ color: KIND_COLOR[message.kind ?? "info"] ?? "var(--color-muted)" }}>
              {t.kinds[message.kind ?? "info"]}
            </span>
          )}
          <time
            data-testid="direct-chat-time"
            dateTime={new Date(message.at * 1000).toISOString()}
            title={fullStamp(message.at, DICTATION_LOCALE[locale])}
            className="ml-auto font-normal normal-case tracking-normal"
          >
            {timeLabel(message.at, DICTATION_LOCALE[locale])}
          </time>
        </div>
        {renderChatMarkdown(systemLineText(message, t.codes))}
        {message.role === "agent" && message.suggestions && (
          <div role="group" aria-label={t.suggestionsLabel} className="mt-2 flex flex-wrap gap-1.5 whitespace-normal">
            {message.suggestions.map((line) => (
              <button
                key={line}
                type="button"
                data-testid="direct-chat-suggestion"
                disabled={status.state !== "ready" || writeLocked || sending}
                onClick={() => void send(line)}
                className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-left text-[15px] text-[var(--color-bright)] disabled:opacity-40"
              >
                {line}
              </button>
            ))}
          </div>
        )}
        {message.role === "user" && message.id === inFlight && (
          <div data-testid="direct-chat-in-flight" className="mt-1 text-right text-[13px] text-[var(--color-muted)]">
            {t.sending}
          </div>
        )}
        {message.role === "user" && message.id !== inFlight && outcomes.has(message.id) && renderOutcome(message.id, outcomes.get(message.id)!)}
      </article>
    );
  }

  function renderOutcome(messageId: string, outcome: Outcome) {
    if (outcome.kind === "notSent") {
      const canPress =
        typeof client.enter === "function" && outcome.presses < ENTER_AGAIN_MAX && status.state === "ready" && !writeLocked;
      return (
        <div data-testid="direct-chat-not-sent" className="mt-1 flex items-center justify-end gap-2 text-[13px] text-[var(--color-yellow)]">
          <span>{t.notSent}</span>
          {canPress && (
            <button
              type="button"
              data-testid="direct-chat-enter-again"
              disabled={pressing !== null}
              onClick={() => void enterAgain(messageId)}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 font-semibold text-[var(--color-bright)] disabled:opacity-40"
            >
              {pressing === messageId ? t.sending : t.sendEnterAgain}
            </button>
          )}
        </div>
      );
    }
    if (outcome.kind === "expired") {
      return (
        <div data-testid="direct-chat-queue-expired" className="mt-1 text-right text-[13px] text-[var(--color-yellow)]">
          {t.queueExpired}
        </div>
      );
    }
    if (outcome.kind === "unknown") {
      // No button: a key pressed now could choose something on the agent's screen in the person's place.
      return (
        <div data-testid="direct-chat-taken-unknown" className="mt-1 text-right text-[13px] text-[var(--color-muted)]">
          {t.takenUnknown}
          {outcome.reason && <span data-testid="direct-chat-taken-reason">{`: ${t.takenReasons[outcome.reason]}`}</span>}
        </div>
      );
    }
    return (
      <div
        data-testid={outcome.kind === "queued" ? "direct-chat-queued" : "direct-chat-sent"}
        className="mt-1 text-right text-[13px] text-[var(--color-muted)]"
      >
        {outcome.kind === "queued" ? t.queued : t.sent}
      </div>
    );
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
        <div className="shrink-0 px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-dim)]">
          {t.agentsHeading}
        </div>
        <nav aria-label={t.agentsNavAria} className="min-h-0 px-2 pb-3 grid content-start gap-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              aria-current={agent.id === agentId ? "page" : undefined}
              onClick={() => setAgentId(agent.id)}
              className="min-h-9 rounded px-3 py-2 text-left text-[13px] font-semibold transition-colors"
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
            <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-dim)]">{t.title}</div>
            <h1 className="m-0 text-[16px] font-bold tracking-wide text-[var(--color-white)]">{selected.label}</h1>
          </div>
          <label className="md:hidden text-[11px] uppercase tracking-wider text-[var(--color-dim)]">
            {t.agentSelect}
            <select
              aria-label={t.agentSelect}
              value={agentId}
              onChange={(event) => setAgentId(event.target.value as typeof agentId)}
              className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-[13px] text-[var(--color-bright)]"
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
          ref={bottom.ref}
          onScroll={bottom.onScroll}
          role="log"
          aria-label={withName(t.messagesWith, selected.label)}
          aria-live="polite"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5"
          data-testid="direct-chat-transcript"
        >
          <div className="w-full flex flex-col gap-3">
            {loading && items.length === 0 && (
              <p role="status" className="m-0 py-8 text-center text-[13px] text-[var(--color-muted)]">{t.loadingConversation}</p>
            )}
            {!loading && items.length === 0 && (
              <p className="m-0 py-8 text-center text-[13px] text-[var(--color-muted)]">{t.empty}</p>
            )}
            {items.map((item, index) => {
              const day = dayKey(item.at);
              const newDay = index === 0 || dayKey(items[index - 1].at) !== day;
              return (
                <Fragment key={item.key}>
                  {newDay && (
                    <div
                      role="separator"
                      data-testid="direct-chat-day"
                      className="self-center py-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-dim)]"
                    >
                      {dayLabel(item.at, t, DICTATION_LOCALE[locale])}
                    </div>
                  )}
                  {item.type === "question" ? (
                    <ChatQuestion
                      question={item.question}
                      agentName={selected.label}
                      t={t}
                      dateLocale={DICTATION_LOCALE[locale]}
                      canAnswer={canAnswer}
                      quoted={replyTo?.kind === "question" && replyTo.id === item.question.id}
                      onAnswer={(choices, words) => answer(item.question.id, choices, words)}
                      onAnswerInWords={writeLocked ? undefined : () => replyFromMenu("question", item.question.id)}
                      onMenu={writeLocked ? undefined : (event) => openMenu("question", item.question.id, event)}
                    />
                  ) : (
                    renderMessage(item.message, item.key, item.repeated)
                  )}
                </Fragment>
              );
            })}
          </div>
          <JumpToLatest
            atBottom={bottom.atBottom}
            unseen={bottom.unseen}
            label={bottom.unseen > 0 ? t.jumpToNew.replace("{count}", String(bottom.unseen)) : t.jumpToLatest}
            onClick={bottom.jump}
          />
        </div>
        {menu && (
          <div
            role="menu"
            aria-label={t.replyAction}
            data-testid="direct-chat-menu"
            className="fixed z-50 min-w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] py-1 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
            // a pointerdown inside the menu must not close it before the click
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              autoFocus
              data-testid="direct-chat-menu-reply"
              onClick={() => replyFromMenu(menu.kind, menu.id)}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-[var(--color-bright)] hover:bg-[var(--color-card)]"
            >
              {t.replyAction}
            </button>
          </div>
        )}

        {writeLocked && (
          <p
            role="note"
            data-testid="direct-chat-read-only-invite"
            className="shrink-0 m-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 sm:px-6 py-2 text-[13px] text-[var(--color-muted)] flex flex-wrap items-center gap-3"
          >
            <span>{t.readOnlyInvite}</span>
            {onConnect && (
              <button
                type="button"
                onClick={onConnect}
                className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[12px] font-semibold text-[var(--color-bright)]"
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
            className="w-full m-0 mb-1.5 text-[13px] text-[var(--color-muted)]"
          >
            {withName(t.destination, selected.label)}
          </p>
          {target && (
            <div
              data-testid="direct-chat-reply-to"
              data-answer={target.kind === "question" && target.words ? "true" : undefined}
              className="w-full mb-1.5 flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-[13px]"
            >
              <span className="shrink-0 text-[var(--color-muted)]">
                {target.kind === "question" && target.words ? t.replyingToQuestion : t.replyingTo}
              </span>
              <b className="min-w-0 flex-1 truncate font-semibold text-[var(--color-base)]" title={target.text}>
                {excerpt(target.text)}
              </b>
              <button
                type="button"
                data-testid="direct-chat-reply-clear"
                aria-label={t.replyClear}
                title={t.replyClear}
                onClick={() => {
                  setReplyTo(null);
                  setAnswerRefusal(null);
                }}
                className="shrink-0 px-1 text-[14px] leading-none text-[var(--color-muted)]"
              >
                ×
              </button>
            </div>
          )}
          {answerRefusal && (
            <p role="alert" data-testid="direct-chat-answer-refused" className="w-full m-0 mb-1.5 text-[13px] text-[var(--color-red)]">
              {answerRefusal}
            </p>
          )}
          <div
            className="w-full flex flex-wrap items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 focus-within:border-[var(--color-border-glow)]"
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
              className="max-h-28 min-h-8 w-full min-w-0 flex-[1_1_16rem] resize-none border-0 bg-transparent px-1 py-1.5 text-[15px] text-[var(--color-base)] outline-none disabled:opacity-50 sm:min-w-48"
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
              className="h-8 shrink-0 self-end rounded-md bg-[var(--color-green)] px-4 text-[12px] font-bold text-[var(--color-void)] disabled:cursor-default disabled:opacity-40"
            >
              {sending ? t.sending : t.send}
            </button>
          </div>
          <p data-testid="direct-chat-keys" className="w-full m-0 mt-1 text-[13px] text-[var(--color-dim)]">
            {t.keysHint}
          </p>
        </form>
      </section>
    </div>
  );
}
