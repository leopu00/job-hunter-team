import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import OwnVpsClaim from "../../components/OwnVpsClaim";
import { useTeamOff } from "../../lib/team-off";
import { StartTeamAction } from "../../shell/StartTeamAction";
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
  outcomeOf,
  sightAfter,
  NOT_WORKING,
  type WorkingSight,
  questionsOf,
  quoteLine,
  settleQueued,
  transcript as conversationItems,
  type Outcome,
} from "./chat-kinds";
import { sameAsBefore } from "./same-as-before";
import { unreadLabel, useChatUnread } from "./chat-unread";
import TeamQuietNotice from "./TeamQuietNotice";
import type { QuietFacts } from "./team-quiet";
import { systemLineText, withoutAttachmentPath } from "./chat-line-text";
import { ChatMessageRow } from "./ChatMessageRow";
import { renderChatText } from "./chat-text";
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
  for (const message of page.messages) {
    const read = cleanMessage(message);
    // A line that did not change keeps the object it had: every read brings fresh objects, and a line whose
    // object is the same draws nothing again (ChatMessageRow), so one new line costs one line, not the history.
    const had = byId.get(message.id);
    byId.set(message.id, had ? sameAsBefore(had, read) : read);
  }
  return [...byId.values()].sort((left, right) => left.at - right.at);
}

/**
 * Ctrl+Enter starts a new line where the cursor is (a textarea does not do it by itself); Enter
 * alone sends, and Shift+Enter keeps the textarea's own new line.
 */
export function newLineAt(value: string, start: number, end: number): { value: string; cursor: number } {
  return { value: `${value.slice(0, start)}\n${value.slice(end)}`, cursor: start + 1 };
}

export { systemLineText, withoutAttachmentPath };

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
export const REOPEN_NO_RETRY = new Set([
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
  "host_not_configured",
  "host_config_invalid",
]);

function StatusBar({
  status,
  operationError,
  reconnecting,
  onRetry,
  onReadAgain,
}: {
  status: DirectChatStatus;
  operationError: string | null;
  reconnecting: boolean;
  onRetry: () => void;
  onReadAgain: () => Promise<boolean>;
}) {
  const locale = appLocale();
  const t = DIRECT_CHAT_TEXT[locale];
  const [slow, setSlow] = useState(false);
  const teamOff = useTeamOff();
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
  // The team of this computer is stopped: the sentence says «start the team», so the bar offers it (the
  // app opened without the team has it in the banner above).
  const teamStopped = (failed || operationError) && code === "local_team_not_running" && !teamOff;

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
        <span className="shrink-0 flex items-center gap-2">
          {teamStopped && <StartTeamAction onStarted={onReadAgain} />}
          <button
            type="button"
            onClick={onRetry}
            disabled={reconnecting}
            className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[12px] font-semibold text-[var(--color-bright)] disabled:opacity-50"
          >
            {reconnecting ? t.reconnecting : t.retry}
          </button>
        </span>
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
  loadQuietFacts,
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
  /** What the team says about itself to explain a long silence (hours, budget...); without it the chat does not explain one. */
  loadQuietFacts?: () => Promise<QuietFacts | null>;
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
  // The paperclip, in the Assistant's chat only: on, or off with the reason the native side gives.
  const [attachState, setAttachState] = useState<{ available: boolean; code?: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachNote, setAttachNote] = useState<{ kind: "warn" | "error"; text: string } | null>(null);
  const attachHere = agentId === "assistente" && Boolean(client.attach) && Boolean(client.attachState);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  // Where the error on the bar came from: the connection (a «ready» that follows ends it) or a read or a
  // send that failed (it stays on the bar until a later read or send gets through, whatever the status says).
  const connectionError = useRef(false);
  const failOperation = (code: string) => {
    connectionError.current = false;
    // The Mentor is not always up (it is switched on when the first positions have a score, and the team brings
    // it back if it stops): «the agent is not running, start the team» would send the person to start a team
    // that is already running.
    setOperationError(code === "agent_not_running" && agentId === "mentor" ? "mentor_not_active" : code);
  };
  // Why an answer written in the composer did not go: it stays in the box.
  const [answerRefusal, setAnswerRefusal] = useState<string | null>(null);
  // What the receipt said of each message of the person's in this view; only a receipt says it.
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(() => new Map());
  // A message whose Enter is being pressed again.
  const [pressing, setPressing] = useState<string | null>(null);
  // Whether the agent shows a running turn, from what the reads say of its screen (never from their absence).
  const [sight, setSight] = useState<WorkingSight>(NOT_WORKING);
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
  // How many messages of each agent the person has not read: the chat on screen is read, the others are looked at slowly.
  const unread = useChatUnread({
    agents: AGENT_IDS,
    openAgent: agentId,
    openMessages: messages,
    read: (request) => client.read({ agentId: request.agentId as DirectChatAgentId }),
    peeking: !embedded && status.state === "ready" && !slowLink,
  });

  useEffect(() => {
    setAgentId(initialAgentId);
  }, [initialAgentId]);

  // The paperclip asks the native side whether it can be used (this computer's team, writing allowed);
  // another agent, or no connection, has none. A note about a file belongs to the chat it was made in.
  useEffect(() => {
    setAttachNote(null);
  }, [agentId]);
  useEffect(() => {
    if (!attachHere || status.state !== "ready") {
      setAttachState(null);
      return;
    }
    let active = true;
    Promise.resolve(client.attachState?.())
      .then((next) => {
        if (active) setAttachState(next ?? { available: false });
      })
      .catch(() => {
        // the bridge could not say: the button stays off, with no reason to give
        if (active) setAttachState({ available: false });
      });
    return () => {
      active = false;
    };
  }, [attachHere, status.state, writeLocked, client]);

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
        setSight((current) => sightAfter(current, event.page.activity));
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
        // The chat may open with the connection closed: leaving the Messages page closes it, and a profile
        // imported from the command line brings the person here with nothing opened. The saved host is
        // enough to open it again, with no question to the person: the pane and the page alike.
        for (let attempt = 1; active && snapshot.state === "disconnected"; attempt += 1) {
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

  // The history stays on screen when only the connection changes (the team stopped under an open chat): it is
  // emptied for another agent or another client, not for a connection that fell.
  const historyOf = useRef<{ client: unknown; agentId: string } | null>(null);
  useEffect(() => {
    if (historyOf.current?.client !== client || historyOf.current.agentId !== agentId) {
      historyOf.current = { client, agentId };
      setMessages([]);
    }
    setQuestions([]);
    setQuestionsHere(false);
    setAnswersInFlight(new Map());
    setReplyTo(null);
    setMenu(null);
    setOutcomes(new Map());
    setSight(NOT_WORKING);
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
        setSight((current) => sightAfter(current, page.activity));
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

  // «Start the team» looks again by itself while the team starts: a try that fails changes nothing on screen (the
  // bar and its button stay), one that works takes the bar away. True: the chat is connected.
  async function readAgain(): Promise<boolean> {
    try {
      const next = await client.reconnect();
      if (next.state !== "ready") return false;
      setOperationError(null);
      setStatus(next);
      return true;
    } catch {
      return false;
    }
  }

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
    // the line under the composer was about the last attachment: once the person writes, it goes
    setAttachNote(null);
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

  // Choose a file in the system's window and give it to the Assistant: the app copies it into the team's
  // folder and tells the Assistant; this page never sees a path.
  async function attachFile() {
    if (!client.attach || attaching || sending || writeLocked || status.state !== "ready" || !attachState?.available) return;
    setAttaching(true);
    setAttachNote(null);
    try {
      const done = await client.attach({ clientMessageId: clientMessageId(), locale });
      if (done.outcome === "sent") {
        // The message left on its own: it is a bubble in the conversation, and its delivery (taken, waiting,
        // not known) is said under it as for any message. No line under the composer: nothing is left to say.
        const receipt = done.receipt;
        if (receipt) setOutcomes((current) => new Map(current).set(receipt.messageId, outcomeOf(receipt, 0)));
        readSoon.current?.();
      } else if (done.outcome === "saved_not_sent") {
        setAttachNote({ kind: "warn", text: withName(t.attachSavedNotSent, done.displayName ?? "") });
      }
    } catch (error) {
      const code = errorCode(error);
      const words: Record<string, string> = { ...t.attachOff, ...t.attachErrors };
      const said = code !== null && Object.prototype.hasOwnProperty.call(words, code) ? words[code] : null;
      setAttachNote({ kind: "error", text: said ?? t.attachErrors.attach_failed });
    } finally {
      setAttaching(false);
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
  const shownQuestions = useMemo(
    () =>
      questions.map((question) => {
        const local = question.state === "open" ? answersInFlight.get(question.id) : undefined;
        return local ? { ...question, state: "answered" as const, answer: local } : question;
      }),
    [questions, answersInFlight],
  );
  const items = useMemo(() => groupRepeatedMessages(conversationItems(messages, shownQuestions)), [messages, shownQuestions]);
  const newDays = useMemo(() => items.map((item, index) => index === 0 || dayKey(items[index - 1].at) !== dayKey(item.at)), [items]);

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
    return message ? { kind: "message", text: message.role === "user" ? withoutAttachmentPath(message.text) : message.text } : null;
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

  // The lines of the conversation are memoized (ChatMessageRow): they get these three as functions that keep their
  // identity, which call the current ones, so a key typed in the composer does not render a line again.
  const handlers = useRef({ openMenu, send, enterAgain });
  handlers.current = { openMenu, send, enterAgain };
  const onMenu = useCallback((id: string, event: { preventDefault(): void; clientX: number; clientY: number }) => handlers.current.openMenu("message", id, event), []);
  const onSend = useCallback((line: string) => void handlers.current.send(line), []);
  const onEnterAgain = useCallback((id: string) => void handlers.current.enterAgain(id), []);
  const enterAvailable = typeof client.enter === "function" && status.state === "ready" && !writeLocked;
  const suggestionsOff = status.state !== "ready" || writeLocked || sending;
  const dateLocale = DICTATION_LOCALE[locale];

  const canSend = status.state === "ready" && !writeLocked && !sending && text.trim().length > 0;
  const composerOff = status.state !== "ready" || sending || writeLocked;

  return (
    <div
      className="min-h-0 overflow-hidden flex flex-col md:flex-row bg-[var(--color-void)]"
      // The whole of the space it is given: in the Shell that is the window under the navbar and its bars (a full-bleed page), so a bar above never pushes the page past the window.
      style={{ height: "100%" }}
      data-testid="direct-chat-shell"
    >
      {!embedded && (
      <aside className="hidden md:flex w-52 shrink-0 min-h-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="shrink-0 px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-dim)]">
          {t.agentsHeading}
        </div>
        <nav aria-label={t.agentsNavAria} className="min-h-0 overflow-y-auto px-2 pb-3 grid content-start gap-1">
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
              <span className="flex items-center justify-between gap-2">
                <span>{agent.label}</span>
                {unread.counts[agent.id] > 0 && (
                  <span
                    data-testid={`unread-${agent.id}`}
                    role="img"
                    aria-label={t.unreadAria.replace("{count}", String(unread.counts[agent.id]))}
                    className="min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5"
                    style={{ background: "var(--color-green)", color: "var(--color-void)" }}
                  >
                    {unreadLabel(unread.counts[agent.id])}
                  </span>
                )}
              </span>
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
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {unread.counts[agent.id] > 0 ? `${agent.label} (${unreadLabel(unread.counts[agent.id])})` : agent.label}
                </option>
              ))}
            </select>
          </label>
        </header>
        )}

        <StatusBar status={status} operationError={operationError} reconnecting={reconnecting} onRetry={() => void retry()} onReadAgain={readAgain} />
        {loadQuietFacts && !embedded && status.state === "ready" && (
          <TeamQuietNotice lastAgentAt={unread.lastAgentAt} loadFacts={loadQuietFacts} />
        )}
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
              const newDay = newDays[index];
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
                    <ChatMessageRow
                      message={item.message}
                      repeated={item.repeated}
                      t={t}
                      agentLabel={selected.label}
                      dateLocale={dateLocale}
                      quoted={replyTo?.kind === "message" && replyTo.id === item.message.id}
                      inFlight={item.message.id === inFlight}
                      outcome={item.message.role === "user" ? outcomes.get(item.message.id) : undefined}
                      enterAvailable={enterAvailable}
                      pressingThis={pressing === item.message.id}
                      pressingAny={pressing !== null}
                      suggestionsOff={item.message.suggestions ? suggestionsOff : false}
                      onMenu={onMenu}
                      onSend={onSend}
                      onEnterAgain={onEnterAgain}
                    />
                  )}
                </Fragment>
              );
            })}
            {sight.working && status.state === "ready" && (
              <div role="status" data-testid="direct-chat-working" className="flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
                <span aria-hidden="true" className="inline-flex items-center gap-1">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted)] animate-pulse motion-reduce:animate-none"
                      style={{ animationDelay: `${dot * 200}ms` }}
                    />
                  ))}
                </span>
                <span>{withName(t.working, selected.label)}</span>
              </div>
            )}
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
          {attachHere && attachState && !attachState.available && attachState.code && attachState.code in t.attachOff && (
            <p data-testid="direct-chat-attach-off" className="w-full m-0 mb-1.5 text-[13px] text-[var(--color-muted)]">
              {t.attachOff[attachState.code as keyof typeof t.attachOff]}
            </p>
          )}
          {attachNote && (
            <p
              role="alert"
              data-testid="direct-chat-attach-note"
              data-kind={attachNote.kind}
              className={`w-full m-0 mb-1.5 text-[13px] ${attachNote.kind === "warn" ? "text-[var(--color-yellow)]" : "text-[var(--color-red)]"}`}
            >
              {attachNote.text}
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
            {attachHere && (
              <button
                type="button"
                data-testid="direct-chat-attach"
                aria-label={t.attach}
                title={attachState && !attachState.available && attachState.code && attachState.code in t.attachOff ? t.attachOff[attachState.code as keyof typeof t.attachOff] : t.attach}
                disabled={composerOff || attaching || !attachState?.available}
                onClick={() => void attachFile()}
                className="h-8 shrink-0 self-end rounded-md border border-[var(--color-border)] px-2 text-[15px] leading-none text-[var(--color-bright)] disabled:cursor-default disabled:opacity-40"
              >
                {attaching ? t.attaching : "📎"}
              </button>
            )}
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
