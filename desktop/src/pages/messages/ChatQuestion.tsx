import { useState, type MouseEvent } from "react";
import type { DirectChatQuestion } from "./direct-chat-contract";
import type { DirectChatText } from "./direct-chat.i18n";
import { answerableHere, answerProblem, KIND_COLOR } from "./chat-kinds";

/**
 * A question the agent asked, in its chat, with its options as buttons. A single choice answers
 * with one click; with several, the options light up and «answer» sends them. Words are written in
 * the chat's own box, not in a second box here: «answer in words» (or right-click → Reply) puts the
 * question over the composer. Once answered the buttons close and the choice stays with ✓, then
 * whether the agent's tool picked it up. Every text of the question is the agent's: plain text,
 * never HTML, never translated.
 */
export default function ChatQuestion({
  question,
  agentName,
  t,
  canAnswer,
  quoted = false,
  onAnswer,
  onAnswerInWords,
  onMenu,
}: {
  question: DirectChatQuestion;
  agentName: string;
  t: DirectChatText;
  /** false when the chat cannot write (not ready, read-only view, an image without answers) */
  canAnswer: boolean;
  /** the composer is answering this question */
  quoted?: boolean;
  /** null when the answer went, else the sentence of why it did not */
  onAnswer: (choices: string[], text: string | null) => Promise<string | null>;
  /** puts this question over the composer, for words */
  onAnswerInWords?: () => void;
  /** right-click → Reply */
  onMenu?: (event: MouseEvent) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = question.state === "open";
  const live = open && canAnswer && answerableHere(question) && !busy;
  const chosen = new Set(question.answer?.choices ?? []);
  const colour = KIND_COLOR[question.kind];

  async function answer(choices: string[]) {
    // what the team would refuse is said here, and nothing goes
    const problem = answerProblem(question, choices, "");
    if (problem) {
      setError(t.answerInvalid[problem]);
      return;
    }
    setBusy(true);
    setError(null);
    const refusal = await onAnswer(choices, null);
    setBusy(false);
    if (refusal === null) setPicked([]);
    else setError(refusal);
  }

  return (
    <article
      data-testid="direct-chat-question"
      data-state={question.state}
      data-kind={question.kind}
      data-quoted={quoted ? "true" : undefined}
      onContextMenu={onMenu}
      className="self-start max-w-[86%] rounded-lg rounded-bl-sm px-4 py-3 text-[12px] leading-relaxed break-words"
      style={{
        color: "var(--color-base)",
        background: "var(--color-card)",
        border: `1px solid ${quoted ? "var(--color-border-glow)" : "var(--color-border)"}`,
        // urgent and blocked: a bar on the left, not the whole border
        boxShadow: colour ? `inset 3px 0 0 ${colour}` : undefined,
      }}
    >
      <div className="mb-1 flex items-center gap-2 text-[8px] font-semibold uppercase tracking-wider text-[var(--color-dim)]">
        <span>{agentName}</span>
        <span data-testid="direct-chat-kind" style={{ color: colour ?? "var(--color-muted)" }}>
          {t.kinds[question.kind]}
        </span>
      </div>
      {question.subject && <p className="m-0 mb-1 font-semibold text-[var(--color-white)]">{question.subject}</p>}
      <p className="m-0 whitespace-pre-wrap">{question.text}</p>

      <div role="group" aria-label={question.subject ?? question.text} className="mt-2 flex flex-wrap gap-1.5">
        {question.options.map((option) => {
          const taken = chosen.has(option.id);
          const lit = picked.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              data-testid="direct-chat-option"
              aria-pressed={!open ? taken : question.multiple ? lit : undefined}
              disabled={!live}
              onClick={() => {
                if (!question.multiple) void answer([option.id]);
                else setPicked(lit ? picked.filter((id) => id !== option.id) : [...picked, option.id]);
              }}
              className="rounded border px-2.5 py-1 text-[11px] font-semibold disabled:cursor-default"
              style={{
                borderColor: taken || lit ? "var(--color-green)" : "var(--color-border)",
                color: taken || lit ? "var(--color-green)" : open ? "var(--color-bright)" : "var(--color-dim)",
              }}
            >
              {taken ? `✓ ${option.label}` : option.label}
            </button>
          );
        })}
      </div>

      {open && (question.multiple || (question.free && onAnswerInWords)) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {question.multiple && (
            <button
              type="button"
              data-testid="direct-chat-answer-choices"
              disabled={!live || picked.length === 0}
              onClick={() => void answer(picked)}
              className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-bright)] disabled:opacity-40"
            >
              {busy ? t.sending : t.answerSend}
            </button>
          )}
          {question.free && onAnswerInWords && (
            <button
              type="button"
              data-testid="direct-chat-answer-in-words"
              disabled={!live}
              onClick={onAnswerInWords}
              className="text-[11px] text-[var(--color-muted)] underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
            >
              {t.answerInWords}
            </button>
          )}
        </div>
      )}

      {question.answer?.text && (
        <p data-testid="direct-chat-answer-text" className="m-0 mt-2 whitespace-pre-wrap text-[var(--color-green)]">
          ✓ {question.answer.text}
        </p>
      )}
      {question.state === "expired" && (
        <p data-testid="direct-chat-answer-expired" className="m-0 mt-1 text-[11px] text-[var(--color-muted)]">
          {t.answerExpired}
        </p>
      )}
      {question.state === "answered" && (
        <p data-testid="direct-chat-answer-seen" className="m-0 mt-1 text-right text-[11px] text-[var(--color-muted)]">
          {question.answer?.seenAt ? t.answerSeen : t.answerWaiting}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 mt-1 text-[11px] text-[var(--color-red)]">
          {error}
        </p>
      )}
    </article>
  );
}
