import { appLocale } from "../../lib/app-locale";
import type { AgentQuestion, AgentQuestions, QuestionOption, QuestionType } from "../../lib/existing-team-agents";
import { pluralText } from "../../lib/plural";
import Link from "../../web-shims/next-link";
import type { AgentsPanelText } from "./AgentsPanel.i18n";

/**
 * The questions an agent asked the person and its unread messages, read by
 * the team (agent_state.py). Only to be shown: nothing decides on them. What
 * the team does not say is «non so», never 0: a zero is shown only when it was
 * read. Every text of a question is the agent's, as it wrote it: plain text,
 * never translated.
 */

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

/** The most urgent first: the one a row's mark takes its colour from. */
const URGENCY: (QuestionType | null)[] = ["urgente", "blocco", "domanda", "completamento", "comunicazione", null];

export const TYPE_COLOR: Record<QuestionType | "none", string> = {
  urgente: "var(--color-red)",
  blocco: "var(--color-yellow)",
  domanda: "var(--color-blue)",
  completamento: "var(--color-green)",
  comunicazione: "var(--color-muted)",
  none: "var(--color-dim)",
};

export function typeLabel(t: AgentsPanelText, type: QuestionType | null): string {
  return type === null ? t.questionTypeNone : t.questionTypes[type];
}

/** The most urgent type among the questions shown, or undefined when none is shown. */
export function mostUrgent(questions: AgentQuestions): QuestionType | null | undefined {
  return URGENCY.find((type) => questions.items.some((item) => item.type === type));
}

/** «99+» past 99, the count itself below. */
export function badgeCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * The count at the top: the open questions of the agents that are up. When the
 * team says it for none of them, «non so»; for only some, the count and that
 * the rest is not known.
 */
export function questionsSummary(t: AgentsPanelText, all: (AgentQuestions | null)[]): string {
  const known = all.filter((questions): questions is AgentQuestions => questions !== null);
  if (known.length === 0) return t.questionsUnknown;
  const open = known.reduce((sum, questions) => sum + questions.open, 0);
  const text = pluralText(appLocale(), open, t.questionsOpen);
  return known.length < all.length ? `${text} ${t.questionsPartlyUnknown}` : text;
}

/** Beside the agent's name in the list: its unread messages, and a mark when it asked something. */
export function QuestionMarks({ t, questions }: { t: AgentsPanelText; questions: AgentQuestions | null }) {
  if (!questions) return null;
  const urgent = questions.open > 0 ? mostUrgent(questions) : undefined;
  const asked =
    questions.open > 0
      ? `${pluralText(appLocale(), questions.open, t.questionsOpen)}${urgent !== undefined ? ` · ${typeLabel(t, urgent)}` : ""}`
      : null;
  if (!asked && questions.unread === 0) return null;
  return (
    // under the state, in its own column: a mark beside it would narrow the state's words
    <span className="flex items-center gap-1 mt-0.5">
      {asked && (
        <span
          data-testid="panel-question-mark"
          data-type={urgent ?? "none"}
          title={asked}
          aria-label={asked}
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: TYPE_COLOR[urgent ?? "none"] }}
        />
      )}
      {questions.unread > 0 && (
        <span
          data-testid="panel-unread"
          title={pluralText(appLocale(), questions.unread, t.unreadMessages)}
          className="text-[11px] font-semibold tabular-nums px-1.5 rounded-full leading-[16px]"
          style={{ background: "var(--color-card)", color: "var(--color-bright)", border: "1px solid var(--color-border)" }}
        >
          {badgeCount(questions.unread)}
        </span>
      )}
    </span>
  );
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(appLocale(), { timeStyle: "short" });
}

function stamp(at: number, now: number): string {
  const day = (ms: number) => new Date(ms).toDateString();
  return day(at) === day(now)
    ? clock(at)
    : new Date(at).toLocaleString(appLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** «scade fra 3 h, poi: Rinvia» — the option it takes is the question's own label. */
export function expiryLine(t: AgentsPanelText, question: AgentQuestion, now: number): string | null {
  if (question.expiresAt === null) return null;
  const left = Math.max(0, question.expiresAt - now);
  const when =
    left < 60 * 60_000
      ? fill(t.questionExpiresMinutes, { minutes: Math.max(1, Math.round(left / 60_000)) })
      : left < 24 * 3_600_000
        ? fill(t.questionExpiresHours, { hours: Math.round(left / 3_600_000) })
        : fill(t.questionExpiresAt, { time: stamp(question.expiresAt, now) });
  const option = question.options.find((item) => item.id === question.fallback);
  return option ? `${when}, ${fill(t.questionThen, { option: option.label })}` : when;
}

type OnAnswer = (question: AgentQuestion, option: QuestionOption) => void;

/**
 * Whether the panel answers it with its buttons: a structured question with one choice and no
 * words of the person. One with several choices or with room for words, and one written before
 * the contract, is answered from Messages.
 */
export function answerable(question: AgentQuestion): question is AgentQuestion & { id: string } {
  return question.id !== null && !question.multiple && !question.free;
}

function Question({
  t,
  question,
  now,
  onAnswer,
  answering,
}: {
  t: AgentsPanelText;
  question: AgentQuestion;
  now: number;
  onAnswer?: OnAnswer;
  answering: string | null;
}) {
  const expiry = expiryLine(t, question, now);
  const buttons = onAnswer !== undefined && answerable(question);
  return (
    <li data-testid="panel-question" data-type={question.type ?? "none"} className="rounded border px-2.5 py-2" style={{ borderColor: "var(--color-border)" }}>
      <p className="text-[11px] flex flex-wrap gap-x-2">
        <span className="font-semibold uppercase tracking-wider" style={{ color: TYPE_COLOR[question.type ?? "none"] }}>
          {typeLabel(t, question.type)}
        </span>
        <span className="text-[var(--color-muted)]">{fill(t.questionAskedAt, { time: stamp(question.at, now) })}</span>
        {expiry && (
          <span data-testid="panel-question-expiry" className="text-[var(--color-muted)]">
            {expiry}
          </span>
        )}
      </p>
      {question.subject && (
        <p className="text-[12px] font-semibold mt-1 break-words" style={{ color: "var(--color-white)" }}>
          {question.subject}
        </p>
      )}
      <p className="text-[11px] mt-0.5 break-words text-[var(--color-bright)]">{question.text}</p>
      {buttons ? (
        <div data-testid="panel-question-answers" className="flex flex-wrap gap-1.5 mt-1.5">
          {question.options.map((option) => (
            <button
              key={option.id}
              type="button"
              data-testid={`panel-answer-${option.id}`}
              data-reversible={option.reversible ? "true" : "false"}
              disabled={answering !== null}
              title={option.reversible ? undefined : t.answerConfirmFirst}
              onClick={() => onAnswer?.(question, option)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)] break-words text-left disabled:opacity-60 disabled:cursor-wait"
            >
              {answering === question.id ? t.answering : option.label}
            </button>
          ))}
        </div>
      ) : (
        question.options.length > 0 && (
          <p data-testid="panel-question-options" className="text-[11px] mt-1 break-words text-[var(--color-muted)]">
            {question.options.map((option) => option.label).join(" · ")}
          </p>
        )
      )}
    </li>
  );
}

/** In the agent's detail: its open questions, the newest first. */
export function QuestionList({
  t,
  questions,
  readOnly,
  now,
  onAnswer,
  answering = null,
  messagesAgent = null,
}: {
  t: AgentsPanelText;
  questions: AgentQuestions | null;
  readOnly: boolean;
  now: number;
  /** only where the panel acts: never in the read-only view */
  onAnswer?: OnAnswer;
  answering?: string | null;
  /** The agent whose chat «Answer from Messages» opens; without one, Messages as it is. */
  messagesAgent?: string | null;
}) {
  if (!questions) {
    return (
      <p data-testid="panel-questions" className="text-[11px] mt-1 text-[var(--color-dim)]" title={t.questionsUnknownWhy}>
        {t.questionsUnknownDetail}
      </p>
    );
  }
  const unread = questions.unread > 0 ? ` · ${pluralText(appLocale(), questions.unread, t.unreadMessages)}` : "";
  if (questions.open === 0) {
    return (
      <p data-testid="panel-questions" className="text-[11px] mt-1 text-[var(--color-muted)]">
        {t.questionsNone}
        {unread}
      </p>
    );
  }
  const more = questions.open - questions.items.length;
  return (
    <div data-testid="panel-questions" className="mt-2">
      <p className="text-[11px] font-semibold text-[var(--color-bright)]">
        {pluralText(appLocale(), questions.open, t.questionsOpen)}
        {unread}
      </p>
      <ul className="flex flex-col gap-1.5 mt-1">
        {questions.items.map((question) => (
          <Question
            key={question.id ?? `row-${question.at}-${question.text}`}
            t={t}
            question={question}
            now={now}
            onAnswer={readOnly ? undefined : onAnswer}
            answering={answering}
          />
        ))}
      </ul>
      {more > 0 && <p className="text-[11px] mt-1 text-[var(--color-muted)]">{pluralText(appLocale(), more, t.questionsMore)}</p>}
      <p className="text-[11px] mt-1 text-[var(--color-muted)]">
        {readOnly ? (
          t.questionsAnswerElsewhere
        ) : (
          <Link href={messagesAgent ? `/messages?agent=${messagesAgent}` : "/messages"} data-testid="panel-questions-messages" className="underline">
            {t.questionsAnswerInMessages}
          </Link>
        )}
      </p>
    </div>
  );
}
