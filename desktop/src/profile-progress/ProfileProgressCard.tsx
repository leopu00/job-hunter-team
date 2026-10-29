import { appLocale } from "../lib/app-locale";
import { fill } from "../lib/text-slots";
import type { ProfileProgress } from "./contract";
import { PROFILE_PROGRESS_TEXT } from "./profile-progress.i18n";

/**
 * The profile beside the chat: a real bar (filled of total) and one row per field, ticked or not, with what
 * the Assistant has written so far. It fills the width it is given and scrolls by itself when it is taller than
 * its column. A profile that cannot be read yet is told in a line, never an error: it appears as the person
 * talks about it.
 */
export function ProfileProgressCard({ progress }: { progress: ProfileProgress }) {
  const t = PROFILE_PROGRESS_TEXT[appLocale()];
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
      {progress.state === "unavailable" && <p className="text-[12px] text-[var(--color-muted)]" data-testid="profile-progress-unavailable">{t.unavailable}</p>}
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
