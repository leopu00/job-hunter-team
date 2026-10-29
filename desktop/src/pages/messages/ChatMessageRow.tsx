import { memo } from "react";
import type { DirectChatMessage } from "./direct-chat-contract";
import type { DirectChatText } from "./direct-chat.i18n";
import { ENTER_AGAIN_MAX, fullStamp, KIND_COLOR, timeLabel, type Outcome } from "./chat-kinds";
import { appLocale } from "../../lib/app-locale";
import { readableRecordText } from "./chat-readable-record";
import { renderChatMarkdown } from "./chat-text";
import { systemLineText } from "./chat-line-text";

/**
 * One line of the conversation. It is a component of its own, and memoized, because the composer's text lives in
 * the screen above: every key the person types renders the screen again, and a line that is rebuilt on each key
 * (its markdown parsed, its dates formatted) costs as much as the history is long. A line renders again only when
 * something it shows changes; the three handlers come from the screen as stable functions.
 */
export interface ChatMessageRowProps {
  message: DirectChatMessage;
  repeated?: number;
  t: DirectChatText;
  agentLabel: string;
  dateLocale: string;
  /** The composer is replying to this line. */
  quoted: boolean;
  /** This line is being sent right now. */
  inFlight: boolean;
  /** How the send of this line ended, when it did not end plainly. */
  outcome?: Outcome;
  /** The keys can be pressed again for a line that was not taken (the client can, the link is ready, the chat is not read-only). */
  enterAvailable: boolean;
  /** The keys are being pressed for this line, and for any line. */
  pressingThis: boolean;
  pressingAny: boolean;
  /** The line's suggested replies cannot be sent now. */
  suggestionsOff: boolean;
  onMenu: (id: string, event: { preventDefault(): void; clientX: number; clientY: number }) => void;
  onSend: (line: string) => void;
  onEnterAgain: (id: string) => void;
}

function ChatMessageRowView({
  message,
  repeated,
  t,
  agentLabel,
  dateLocale,
  quoted,
  inFlight,
  outcome,
  enterAvailable,
  pressingThis,
  pressingAny,
  suggestionsOff,
  onMenu,
  onSend,
  onEnterAgain,
}: ChatMessageRowProps) {
  function renderOutcome(messageId: string, outcome: Outcome) {
    if (outcome.kind === "notSent") {
      const canPress =
        enterAvailable && outcome.presses < ENTER_AGAIN_MAX;
      return (
        <div data-testid="direct-chat-not-sent" className="mt-1 flex items-center justify-end gap-2 text-[13px] text-[var(--color-yellow)]">
          <span>{t.notSent}</span>
          {canPress && (
            <button
              type="button"
              data-testid="direct-chat-enter-again"
              disabled={pressingAny}
              onClick={() => onEnterAgain(messageId)}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 font-semibold text-[var(--color-bright)] disabled:opacity-40"
            >
              {pressingThis ? t.sending : t.sendEnterAgain}
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
    if (outcome.kind === "late") {
      return (
        <div data-testid="direct-chat-sent-late" className="mt-1 text-right text-[13px] text-[var(--color-yellow)]">
          {t.queueLate}
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

  return (
    <article
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
            : quoted
              ? "var(--color-border-glow)"
              : "var(--color-border)"
        }`,
        // urgent and blocked: a bar on the left, not the whole border
        boxShadow: message.role === "agent" && KIND_COLOR[message.kind ?? "info"] ? `inset 3px 0 0 ${KIND_COLOR[message.kind ?? "info"]}` : undefined,
      }}
      data-quoted={quoted ? "true" : undefined}
      onContextMenu={message.role === "system" ? undefined : (event) => onMenu(message.id, event)}
    >
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-dim)]">
        <span>{message.role === "user" ? t.you : message.role === "system" ? t.system : agentLabel}</span>
        {repeated && repeated > 1 && <span data-testid="direct-chat-repeat">×{repeated}</span>}
        {message.role === "agent" && (
          <span data-testid="direct-chat-kind" data-kind={message.kind ?? "info"} style={{ color: KIND_COLOR[message.kind ?? "info"] ?? "var(--color-muted)" }}>
            {t.kinds[message.kind ?? "info"]}
          </span>
        )}
        <time
          data-testid="direct-chat-time"
          dateTime={new Date(message.at * 1000).toISOString()}
          title={fullStamp(message.at, dateLocale)}
          className="ml-auto font-normal normal-case tracking-normal"
        >
          {timeLabel(message.at, dateLocale)}
        </time>
      </div>
      {renderChatMarkdown(message.role === "user" ? systemLineText(message, t.codes) : readableRecordText(systemLineText(message, t.codes), appLocale()))}
      {message.role === "agent" && message.suggestions && (
        <div role="group" aria-label={t.suggestionsLabel} className="mt-2 flex flex-wrap gap-1.5 whitespace-normal">
          {message.suggestions.map((line) => (
            <button
              key={line}
              type="button"
              data-testid="direct-chat-suggestion"
              disabled={suggestionsOff}
              onClick={() => onSend(line)}
              className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-left text-[15px] text-[var(--color-bright)] disabled:opacity-40"
            >
              {line}
            </button>
          ))}
        </div>
      )}
      {message.role === "user" && inFlight && (
        <div data-testid="direct-chat-in-flight" className="mt-1 text-right text-[13px] text-[var(--color-muted)]">
          {t.sending}
        </div>
      )}
      {message.role === "user" && !inFlight && outcome && renderOutcome(message.id, outcome)}
    </article>
  );
}

export const ChatMessageRow = memo(ChatMessageRowView);
