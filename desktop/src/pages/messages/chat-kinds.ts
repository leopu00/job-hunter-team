import type {
  ChatKind,
  DirectChatAnswer,
  DirectChatMessage,
  DirectChatPage,
  DirectChatQuestion,
  DirectChatQuestionOption,
  MessageKind,
} from "./direct-chat-contract";

/**
 * The kinds of the chat and the questions an agent asks, read defensively: what comes from the
 * team is the agent's (an LLM's) and an older image may not have it. A value outside the closed
 * lists is dropped, as for the system lines' codes; nothing here ever throws.
 */

export const MESSAGE_KINDS: readonly MessageKind[] = ["urgent", "blocked", "completed", "info"];
export const CHAT_KINDS: readonly ChatKind[] = ["urgent", "blocked", "question", "completed", "info"];

/** Only urgent and blocked are coloured: the others are told by their label alone. */
export const KIND_COLOR: Partial<Record<ChatKind, string>> = {
  urgent: "var(--color-red)",
  blocked: "var(--color-yellow)",
};

/** The limits of the team's questions: longer text is cut, more options are not shown. */
export const QUESTION_LIMITS = { subject: 120, text: 2000, label: 60, free: 1000, options: 8 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const cut = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);

/** A message's kind: one of the list, `question` and anything else count as info. */
export function messageKind(value: unknown): MessageKind {
  return (MESSAGE_KINDS as readonly unknown[]).includes(value) ? (value as MessageKind) : "info";
}

/** A question's kind: one of the five; anything else counts as info, as the team reads it. */
export function questionKind(value: unknown): ChatKind {
  return (CHAT_KINDS as readonly unknown[]).includes(value) ? (value as ChatKind) : "info";
}

/** The limits of the replies an agent suggests under a message. */
export const SUGGESTION_LIMITS = { min: 2, max: 5, chars: 240 } as const;

/** The agent's suggested replies: 2 to 5 distinct lines of at most 240 characters, or none at all. */
export function suggestionsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    const line = item.trim();
    if (!line || line.length > SUGGESTION_LIMITS.chars || /[\r\n]/.test(line)) return undefined;
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  return lines.length >= SUGGESTION_LIMITS.min && lines.length <= SUGGESTION_LIMITS.max ? lines : undefined;
}

/** A message with only what the screen can trust: the kind from the list and the suggestions, on the agent's rows only. */
export function cleanMessage(message: DirectChatMessage): DirectChatMessage {
  const { kind, suggestions, ...rest } = message as DirectChatMessage & Record<string, unknown>;
  // a message has no subject yet: only the questions have one
  delete (rest as Record<string, unknown>).subject;
  const out: DirectChatMessage = { ...(rest as DirectChatMessage) };
  if (message.role === "agent") {
    out.kind = messageKind(kind);
    const lines = suggestionsOf(suggestions);
    if (lines) out.suggestions = lines;
  }
  return out;
}

function cleanOption(value: unknown): DirectChatQuestionOption | null {
  if (!isObject(value) || typeof value.id !== "string" || !value.id || typeof value.label !== "string") return null;
  const label = value.label.trim();
  return label ? { id: value.id, label: cut(label, QUESTION_LIMITS.label) } : null;
}

function cleanAnswer(value: unknown, options: DirectChatQuestionOption[]): DirectChatAnswer | undefined {
  if (!isObject(value) || !isTime(value.at)) return undefined;
  const ids = new Set(options.map((o) => o.id));
  const choices = Array.isArray(value.choices) ? value.choices.filter((c): c is string => typeof c === "string" && ids.has(c)) : [];
  const text = typeof value.text === "string" && value.text.trim() ? cut(value.text.trim(), QUESTION_LIMITS.free) : undefined;
  if (choices.length === 0 && !text) return undefined;
  return {
    choices,
    ...(text ? { text } : {}),
    at: value.at,
    // an origin the app does not know is said as unknown, never as the person's
    origin: value.origin === "user" || value.origin === "expiry" ? value.origin : "unknown",
    seenAt: isTime(value.seenAt) ? value.seenAt : null,
  };
}

/** A question as the screen shows it, or null when it cannot be one (no id, no time, no text, no options). */
export function cleanQuestion(value: unknown): DirectChatQuestion | null {
  if (!isObject(value) || typeof value.id !== "string" || !value.id || !isTime(value.at)) return null;
  if (typeof value.text !== "string" || !value.text.trim()) return null;
  const seen = new Set<string>();
  const options = (Array.isArray(value.options) ? value.options : [])
    .map(cleanOption)
    .filter((o): o is DirectChatQuestionOption => o !== null && !seen.has(o.id) && (seen.add(o.id), true))
    .slice(0, QUESTION_LIMITS.options);
  // the team asks with 2 to 8 options, always: a question without one is not shown
  if (options.length === 0) return null;
  const answer = cleanAnswer(value.answer, options);
  const state = value.state === "answered" || value.state === "expired" ? value.state : "open";
  const subject = typeof value.subject === "string" && value.subject.trim() ? cut(value.subject.trim(), QUESTION_LIMITS.subject) : undefined;
  return {
    id: value.id,
    at: value.at,
    kind: questionKind(value.kind),
    ...(subject ? { subject } : {}),
    text: cut(value.text.trim(), QUESTION_LIMITS.text),
    options,
    multiple: value.multiple === true,
    free: value.free === true,
    expiresAt: isTime(value.expiresAt) ? value.expiresAt : null,
    // an answer read from the team closes the question, whatever its state says
    state: answer ? (answer.origin === "expiry" ? "expired" : "answered") : state,
    ...(answer ? { answer } : {}),
  };
}

/** The questions of a page: the valid ones, by time; an older image without the field has none. */
export function questionsOf(page: DirectChatPage): DirectChatQuestion[] {
  if (!Array.isArray(page.questions)) return [];
  return page.questions
    .map(cleanQuestion)
    .filter((q): q is DirectChatQuestion => q !== null)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

/** The kinds that ask the person for an answer. */
export function asksAnswer(kind: ChatKind): boolean {
  return kind === "urgent" || kind === "blocked" || kind === "question";
}

const KIND_RANK: Record<ChatKind, number> = { urgent: 0, blocked: 1, question: 2, completed: 3, info: 3 };

/** Urgent, blocked, question; within a kind the oldest first, then the id, so the order does not move between reads. */
export function sortQuestions(questions: readonly DirectChatQuestion[]): DirectChatQuestion[] {
  return [...questions].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The open questions the chat's own box can answer in words: those that take words. Oldest first. */
export function wordQuestions(questions: readonly DirectChatQuestion[]): DirectChatQuestion[] {
  return questions
    .filter((q) => q.state === "open" && q.free)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Why the team would refuse this answer, said before it goes; null when it would take it. */
export type AnswerProblem = "choice_unknown" | "single_choice_only" | "free_text_not_allowed" | "empty_answer" | "text_too_long";

export function answerProblem(question: Pick<DirectChatQuestion, "options" | "multiple" | "free">, choices: string[], text: string): AnswerProblem | null {
  const words = text.trim();
  if (choices.length === 0 && !words) return "empty_answer";
  const ids = new Set(question.options.map((o) => o.id));
  if (choices.some((c) => !ids.has(c))) return "choice_unknown";
  if (choices.length > 1 && !question.multiple) return "single_choice_only";
  if (words && !question.free) return "free_text_not_allowed";
  if (words.length > QUESTION_LIMITS.free) return "text_too_long";
  return null;
}

/** Whether the person can answer it here: while it is open. */
export function answerableHere(question: DirectChatQuestion): boolean {
  return question.state === "open";
}

export type TranscriptItem =
  | { type: "message"; at: number; key: string; message: DirectChatMessage }
  | { type: "question"; at: number; key: string; question: DirectChatQuestion };

/** Messages and questions in one conversation, by time; a question after a message of the same instant. */
export function transcript(messages: DirectChatMessage[], questions: DirectChatQuestion[]): TranscriptItem[] {
  const items: TranscriptItem[] = [
    ...messages.map((message) => ({ type: "message" as const, at: message.at, key: `m:${message.id}`, message })),
    ...questions.map((question) => ({ type: "question" as const, at: question.at, key: `q:${question.id}`, question })),
  ];
  return items.sort((a, b) => a.at - b.at || (a.type === b.type ? 0 : a.type === "message" ? -1 : 1));
}

/** How many times the person may press Enter again on one message the agent's CLI did not take. */
export const ENTER_AGAIN_MAX = 3;

/** Why the team cannot say whether the agent's CLI took a text: a closed list, the rest is not shown. */
export const TAKEN_REASONS = ["menu", "permission", "login", "busy", "not_ours", "empty_unseen", "unreadable", "unconfirmed", "late"] as const;
export type TakenReason = (typeof TAKEN_REASONS)[number];

/**
 * What a receipt said of a message of the person's: sent (`sent`), in the agent's mailbox
 * (`queued`), pasted and still in the composer (`notSent`, Enter may be pressed again), or not
 * known (`unknown`, nothing may be pressed). «Sent», never «taken»: until the team's delivery
 * proves it, the app does not say the agent took it. A receipt from an older image has no
 * `taken`: its `state` alone decides, as before.
 */
export type Outcome =
  | { kind: "sent" }
  | { kind: "queued"; watched?: true }
  | { kind: "expired" }
  | { kind: "notSent"; presses: number }
  | { kind: "unknown"; reason?: TakenReason };

export function outcomeOf(receipt: { state?: unknown; taken?: unknown; reason?: unknown; queue?: unknown }, presses: number): Outcome {
  if (receipt.taken === false) return { kind: "notSent", presses };
  if (receipt.taken === null) {
    const reason = (TAKEN_REASONS as readonly unknown[]).includes(receipt.reason) ? (receipt.reason as TakenReason) : undefined;
    return reason ? { kind: "unknown", reason } : { kind: "unknown" };
  }
  if (receipt.taken !== true && receipt.state === "queued") {
    return receipt.queue === "terminal" ? { kind: "queued", watched: true } : { kind: "queued" };
  }
  return { kind: "sent" };
}

/**
 * A turn the team holds back while its agent works (a `watched` queued outcome) is settled only by what
 * the page says of it: how it ended (`settled`), mapped as the direct send maps a receipt, never by its
 * absence from `queued`. A queued turn nobody watches (the mailbox) stays as it is, and so does every
 * outcome when the page has no word for it (an older image).
 */
export function settleQueued(
  outcomes: ReadonlyMap<string, Outcome>,
  settled: readonly { id: string; how: string }[] | undefined,
): ReadonlyMap<string, Outcome> {
  if (!Array.isArray(settled) || settled.length === 0) return outcomes;
  let next: Map<string, Outcome> | null = null;
  for (const ending of settled) {
    const outcome = outcomes.get(ending.id);
    if (!outcome || outcome.kind !== "queued" || !outcome.watched) continue;
    const became: Outcome | null =
      ending.how === "taken" ? { kind: "sent" }
      : ending.how === "pending" ? outcomeOf({ taken: false }, 0)
      : ending.how === "unconfirmed" ? outcomeOf({ taken: null, reason: "unconfirmed" }, 0)
      : ending.how === "late" ? outcomeOf({ taken: null, reason: "late" }, 0)
      : ending.how === "expired" ? { kind: "expired" }
      : null;
    if (!became) continue;
    next ??= new Map(outcomes);
    next.set(ending.id, became);
  }
  return next ?? outcomes;
}

/**
 * Where the person's last turn stands, in the steps the page tells: `queued` (in the agent's mailbox, not
 * yet typed), `taken` (the agent's CLI took it, with proof) and `working` (taken, and the agent shows a
 * running turn now). «Sent» is the page's own in-flight state. The other outcomes (`notSent`, `unknown`,
 * `expired`) have their own words and buttons, so they have no step. Only the page's `activity` can say
 * `working`: absent is not known and stays `taken`, never a guess.
 */
export type DeliveryStage = "queued" | "taken" | "working";

export function deliveryStage(outcome: Outcome, activity?: "working" | "idle"): DeliveryStage | null {
  if (outcome.kind === "queued") return "queued";
  if (outcome.kind !== "sent") return null;
  return activity === "working" ? "working" : "taken";
}

// ── days and quotes ─────────────────────────────────────────────────────────

/** How long a quote of a message is: an excerpt, not the whole of it. */
export const QUOTE_MAX = 120;

/** A message's excerpt for «reply to» and for the quote: on one line, at most QUOTE_MAX characters. */
export function excerpt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX - 1)}…` : line;
}

/** The line that opens a message written in reply to another: the quote goes in the text the agent reads. */
export function quoteLine(prefix: string, text: string): string {
  return `↩ ${prefix}: "${excerpt(text)}"`;
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Calendar days from `from` to `to`, in the viewer's time zone: 0 the same day, 1 the day after.
 * Midnights are compared, not instants (23:50 and 00:10 are a day apart); the rounding absorbs the
 * 23- and 25-hour days of the clock change.
 */
export function calendarDays(from: Date, to: Date): number {
  return Math.round((midnight(to) - midnight(from)) / 86_400_000);
}

/** The day a time (seconds, as the team gives them) falls on, in the viewer's zone: the separators' key. */
export function dayKey(at: number): string {
  const d = new Date(at * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** The separator's label: «today» and «yesterday» read faster than a date; else the full date. */
export function dayLabel(at: number, words: { today: string; yesterday: string }, dateLocale: string, now = new Date()): string {
  const d = new Date(at * 1000);
  const days = calendarDays(d, now);
  if (days === 0) return words.today;
  if (days === 1) return words.yesterday;
  return d.toLocaleDateString(dateLocale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** The time of a message, to the minute, in the person's locale: «14:05». */
export function timeLabel(at: number, dateLocale: string): string {
  return new Date(at * 1000).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" });
}

/** The whole date and time of a message, for the tooltip. */
export function fullStamp(at: number, dateLocale: string): string {
  return new Date(at * 1000).toLocaleString(dateLocale, { dateStyle: "full", timeStyle: "medium" });
}
