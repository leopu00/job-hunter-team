import { useState } from "react";
import { appLocale } from "../lib/app-locale";
import { reconnectDirectChat } from "../lib/direct-chat";
import { describeError } from "../lib/error-catalog";
import { fill } from "../lib/text-slots";
import { BUDGET_TEXT } from "../pages/budget/budget.i18n";
import { PROFILE_REREAD_EVENT, type ProfileProgress } from "./contract";
import { PROFILE_PROGRESS_TEXT } from "./profile-progress.i18n";

/**
 * The profile beside the chat: a real bar (filled of total) and one row per field, ticked or not, with what
 * the Assistant has written so far. It fills the width it is given and scrolls by itself when it is taller than
 * its column. A profile the team does not have yet is told in a line, never an error: it appears as the person
 * talks about it. A read that FAILED (the chat not connected, too long, an answer the app does not recognise) says its own reason.
 */
export function ProfileProgressCard({ progress }: { progress: ProfileProgress }) {
  const t = PROFILE_PROGRESS_TEXT[appLocale()];
  const [reconnecting, setReconnecting] = useState(false);
  // «Reconnect the chat»: the same native reconnect the Budget page and the chat's own page use; then the profile is read again.
  const reconnect = async () => {
    setReconnecting(true);
    try {
      await reconnectDirectChat();
    } catch {
      // the next read says the reason again
    } finally {
      setReconnecting(false);
      window.dispatchEvent(new Event(PROFILE_REREAD_EVENT));
    }
  };
  const failure = progress.state === "unavailable" && progress.reason ? describeError(progress.reason, { fallback: "profile_unavailable", locale: appLocale() }) : null;
  const complete = progress.state === "ready" && progress.total > 0 && progress.filled >= progress.total;
  return (
    <section
      aria-labelledby="profile-progress-title"
      data-testid="profile-progress"
      data-state={progress.state}
      className="flex h-full max-h-full min-w-0 flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
    >
      <h2 id="profile-progress-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.title}</h2>
      {progress.state === "loading" && <p className="text-[12px] text-[var(--color-muted)]" role="status">{t.loading}</p>}
      {progress.state === "unavailable" && !failure && <p className="text-[12px] text-[var(--color-muted)]" data-testid="profile-progress-unavailable">{t.unavailable}</p>}
      {failure && <p className="text-[12px] text-[var(--color-muted)]" role="status" data-testid="profile-progress-failed">{failure.text} {failure.action}</p>}
      {progress.state === "unavailable" && progress.reason === "disconnected" && (
        <button
          type="button"
          data-testid="profile-progress-reconnect"
          disabled={reconnecting}
          onClick={() => void reconnect()}
          className="self-start rounded border border-[var(--color-border)] px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-bright)] disabled:opacity-60"
        >
          {BUDGET_TEXT[appLocale()].reconnect}
        </button>
      )}
      {progress.state === "ready" && (
        <>
          <div className="flex flex-col gap-1">
            <progress
              value={progress.filled}
              max={progress.total}
              aria-label={t.progressAria}
              className="h-2 w-full"
              data-testid="profile-progress-bar"
            />
            <p className="text-[11px] text-[var(--color-muted)]" data-testid="profile-progress-counter">
              {complete ? t.complete : fill(t.counter, { filled: progress.filled, total: progress.total })}
            </p>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {progress.fields.map((field) => (
              <li key={field.key} data-field={field.key} data-done={field.done} className="flex min-w-0 items-baseline gap-2 text-[12px]">
                <span aria-hidden="true" className={field.done ? "text-[var(--color-green)]" : "text-[var(--color-muted)]"}>{field.done ? "✓" : "○"}</span>
                <span className="sr-only">{field.done ? t.filledAria : t.missingAria}</span>
                <span className="shrink-0 text-[var(--color-bright)]">{field.label}</span>
                {field.value && <span className="min-w-0 truncate text-[var(--color-muted)]" title={field.value}>{field.value}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
