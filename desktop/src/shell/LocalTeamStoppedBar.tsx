import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { useLocalTeamStopped } from "../lib/local-team-data";
import { REFRESH_EVENT } from "./refresh-event";
import { StartTeamAction } from "./StartTeamAction";

/**
 * The pages read the team on this computer and its container is not running: they would show empty lists
 * with no reason. This says why, with the button that starts the team; once it is up the page reads again.
 */
export function LocalTeamStoppedBar() {
  const stopped = useLocalTeamStopped();
  if (!stopped) return null;
  const copy = describeError("local_team_not_running", { locale: appLocale() });
  return (
    <div
      role="status"
      data-testid="local-team-stopped"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <span>{copy.text} {copy.action}</span>
      <StartTeamAction onStarted={() => window.dispatchEvent(new Event(REFRESH_EVENT))} />
    </div>
  );
}
