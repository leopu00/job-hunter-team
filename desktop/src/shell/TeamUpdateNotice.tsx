import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import TeamUpdateRun from "../components/TeamUpdateRun";
import { TEAM_UPDATE_RUN_TEXT } from "../components/TeamUpdateRun.i18n";
import { appLocale } from "../lib/app-locale";
import { ackedTeamImage, checkTeamUpdate, noteTeamUpdateChecked, teamUpdateCheckDue } from "../lib/team-update";

/**
 * True when the team is not on the image of this app and the person has not already updated it to this very pair. Once a
 * day, only in the desktop app; any doubt is «no». The check downloads nothing and starts no process.
 */
export async function teamIsOlderThanApp(): Promise<boolean> {
  if (!isTauri() || !teamUpdateCheckDue()) return false;
  try {
    const outcome = await checkTeamUpdate();
    noteTeamUpdateChecked();
    return outcome.ok && outcome.changed && (outcome.imageId === "" || outcome.imageId !== ackedTeamImage());
  } catch {
    // the team cannot be reached or the view may not act on it: nothing to say, and it asks again at the next start
    return false;
  }
}

/**
 * A line at the top while the team is not on the image of this app (JHT-T173), with the button that updates it.
 * It asks once a day at startup, changes nothing by itself and can be put off until the next start. The update is the
 * same one the error messages offer: a confirmation, the wait, then the outcome. A finished update leaves its outcome
 * on screen (without the sentence that the team is older) until the person closes it.
 */
export function TeamUpdateNotice({ check = teamIsOlderThanApp }: { check?: () => Promise<boolean> }) {
  const t = TEAM_UPDATE_RUN_TEXT[appLocale()];
  const [older, setOlder] = useState(false);
  const [open, setOpen] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let live = true;
    check()
      .then((found) => {
        if (live && found) setOlder(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [check]);

  if (!older) return null;
  return (
    <div
      role="status"
      data-testid="team-update-notice"
      className="px-4 py-2 text-[12px] border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!finished && <strong>{t.notice}</strong>}
        {!open && (
          <>
            <button
              type="button"
              data-testid="team-update-notice-button"
              className="ml-auto px-3 py-1 rounded border border-[var(--color-border)] text-[11px] font-semibold"
              onClick={() => setOpen(true)}
            >
              {t.button}
            </button>
            <button
              type="button"
              data-testid="team-update-notice-later"
              className="px-3 py-1 rounded border border-[var(--color-border)] text-[11px]"
              onClick={() => setOlder(false)}
            >
              {t.noticeLater}
            </button>
          </>
        )}
      </div>
      {open && <TeamUpdateRun onClose={() => setOlder(false)} onDone={() => setFinished(true)} />}
    </div>
  );
}
