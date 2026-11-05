import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { useLocalTeamSavedAt, useLocalTeamStopped } from "../lib/local-team-data";
import { LOCAL_TEAM_DATA_TEXT } from "../lib/local-team-data.i18n";
import { REFRESH_EVENT } from "./refresh-event";
import { StartTeamAction } from "./StartTeamAction";

/** «14:05», or the day too when the data are not from today. */
export function savedMoment(at: number, locale: string, now: Date = new Date()): string {
  const when = new Date(at * 1000);
  const sameDay = when.toDateString() === now.toDateString();
  try {
    return sameDay
      ? when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : when.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return when.toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * The pages read the team on this computer and its container is not running. When the team saved its data the pages show them
 * and this says so, with when they were written and the button that starts the team; when there is nothing to show it says why
 * the pages are empty. Once the team is up the page reads again.
 */
export function LocalTeamStoppedBar() {
  const stopped = useLocalTeamStopped();
  const savedAt = useLocalTeamSavedAt();
  if (!stopped && savedAt === null) return null;
  const locale = appLocale();
  const copy = describeError("local_team_not_running", { locale });
  const saved = LOCAL_TEAM_DATA_TEXT[locale];
  const showing = savedAt !== null;
  return (
    <div
      role="status"
      data-testid={showing ? "local-team-saved" : "local-team-stopped"}
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      {showing ? (
        <span>
          {savedAt > 0 ? saved.savedAt.replace("{time}", savedMoment(savedAt, locale)) : saved.savedNoTime} {saved.savedHint}
        </span>
      ) : (
        <span>{copy.text} {copy.action}</span>
      )}
      <StartTeamAction onStarted={() => window.dispatchEvent(new Event(REFRESH_EVENT))} />
    </div>
  );
}
