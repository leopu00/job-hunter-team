import type { DirectChatText } from "./direct-chat.i18n";
import type { Outcome } from "./chat-kinds";

/**
 * Where the person's message stands, in one small mark under it: a clock (in the agent's queue), one tick
 * (sent), two ticks (the agent's CLI took it, proven by the team), a bent arrow (the agent answered since).
 * The mark is drawn, not typed, and says the same in words next to it and in its title.
 */
export type Mark = "queued" | "sent" | "read" | "answered" | "unanswered";

/** The mark of a line, or null where the outcome has its own words (not sent, expired, late, not known) or none is known. */
export function markOf(outcome: Outcome | undefined, answered: boolean): Mark | null {
  if (outcome && outcome.kind !== "queued" && outcome.kind !== "sent") return answered ? "answered" : null;
  if (answered) return "answered";
  if (!outcome) return null;
  if (outcome.kind === "queued") return "queued";
  return outcome.taken === true ? "read" : "sent";
}

function Icon({ mark }: { mark: Mark }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;
  if (mark === "queued")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.6V8l2.3 1.4" />
      </svg>
    );
  if (mark === "sent")
    return (
      <svg {...common}>
        <path d="M3.5 8.4l3 3 6-7" />
      </svg>
    );
  if (mark === "read")
    return (
      <svg {...common}>
        <path d="M1.8 8.6l3 3 5.4-6.4" />
        <path d="M7.4 11.2l.4.4 6.4-7.6" />
      </svg>
    );
  if (mark === "unanswered")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="M5.4 8h5.2" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M6.4 3.6L2.8 7l3.6 3.4" />
      <path d="M3.2 7h6.2a3.6 3.6 0 013.6 3.6V12" />
    </svg>
  );
}

export function DeliveryMark({ mark, t }: { mark: Mark; t: DirectChatText }) {
  const word = { queued: t.queued, sent: t.sent, read: t.read, answered: t.answered, unanswered: t.unanswered }[mark];
  const help = { queued: t.queuedHelp, sent: t.sentHelp, read: t.readHelp, answered: t.answeredHelp, unanswered: t.unansweredHelp }[mark];
  return (
    <div
      // «sent» and «read» are one family (the team took the line): the same test id, told apart by data-mark
      data-testid={`direct-chat-${mark === "answered" ? "answered" : mark === "unanswered" ? "unanswered" : mark === "queued" ? "queued" : "sent"}`}
      data-mark={mark}
      title={help}
      className="mt-1 flex items-center justify-end gap-1.5 text-[14px]"
      style={{ color: mark === "answered" || mark === "read" ? "var(--color-green)" : mark === "unanswered" ? "var(--color-yellow)" : "var(--color-muted)" }}
    >
      <Icon mark={mark} />
      <span>{word}</span>
    </div>
  );
}
