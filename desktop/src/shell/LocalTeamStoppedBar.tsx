import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { useLocalTeamSavedAt, useLocalTeamStopped } from "../lib/local-team-data";
import { LOCAL_TEAM_DATA_TEXT } from "../lib/local-team-data.i18n";
import { REFRESH_EVENT } from "./refresh-event";
import { StartTeamAction } from "./StartTeamAction";

/** The hour of the saved data and, when they are not from today, their day too («03/11»): an hour alone would make old data look new. */
export function savedMoment(at: number, locale: string, now: Date = new Date()): { today: boolean; day: string; time: string } {
  const when = new Date(at * 1000);
  const today = when.toDateString() === now.toDateString();
  try {
    return {
      today,
      day: when.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
      time: when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    };
  } catch {
    const iso = when.toISOString();
    return { today, day: iso.slice(5, 10).replace("-", "/"), time: iso.slice(11, 16) };
  }
}

/** The sentence of the bar for saved data written at `at`: «…alle 14:05», or «…il 03/11 alle 23:10» when it is not today. */
export function savedSentence(at: number, locale: Locale, now: Date = new Date()): string {
  const { today, day, time } = savedMoment(at, locale, now);
  const copy = LOCAL_TEAM_DATA_TEXT[locale];
  return (today ? copy.savedAt : copy.savedAtDay).replace("{day}", day).replace("{time}", time);
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
          {savedAt > 0 ? savedSentence(savedAt, locale) : saved.savedNoTime} {saved.savedHint}
        </span>
      ) : (
        <span>{copy.text} {copy.action}</span>
      )}
      <StartTeamAction onStarted={() => window.dispatchEvent(new Event(REFRESH_EVENT))} />
    </div>
  );
}
