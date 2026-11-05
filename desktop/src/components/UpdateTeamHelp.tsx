import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";
import { appLocale } from "../lib/app-locale";
import { TEAM_UPDATE_COMMAND, wantsTeamUpdate } from "../lib/team-update";
import TeamUpdateRun from "./TeamUpdateRun";
import { UPDATE_TEAM_TEXT } from "./UpdateTeamHelp.i18n";

type Copy = "idle" | "copied" | "failed";

/**
 * Under any message that asks to «update the team»: a button. In the desktop app it updates the team (JHT-T173: the native
 * side runs `jht upgrade --json` on the team's host, or the installer of a test install again, after the person confirms,
 * and the outcome is shown here). Where the app cannot do it (outside the desktop, or a host whose wrapper is older than
 * the update protocol) it opens a short guide instead: which program to open, the command to paste with a «Copy the
 * command» button, what to do afterwards. It shows nothing for any other error.
 */
export default function UpdateTeamHelp({ code }: { code: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [copy, setCopy] = useState<Copy>("idle");
  if (!wantsTeamUpdate(code)) return null;
  const t = UPDATE_TEAM_TEXT[appLocale()];

  async function copyCommand() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(TEAM_UPDATE_COMMAND);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  const buttonClass = "text-[12px] font-semibold px-4 py-2 rounded border border-[var(--color-border)] text-[var(--color-bright)]";
  return (
    <div data-testid="update-team">
      {running ? (
        <TeamUpdateRun
          onClose={() => setRunning(false)}
          onGuide={() => {
            setRunning(false);
            setOpen(true);
          }}
        />
      ) : !open ? (
        <button
          type="button"
          data-testid="update-team-button"
          className={`mt-3 ${buttonClass}`}
          onClick={() => (isTauri() ? setRunning(true) : setOpen(true))}
        >
          {t.button}
        </button>
      ) : (
        <section
          role="region"
          aria-labelledby="update-team-title"
          data-testid="update-team-guide"
          className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-[14px] leading-6 text-[var(--color-base)]"
        >
          <h3 id="update-team-title" className="m-0 text-[15px] font-semibold text-[var(--color-white)]">{t.title}</h3>
          <p className="m-0 mt-1">{t.intro}</p>
          <ol className="m-0 mt-2 pl-6 list-decimal flex flex-col gap-2">
            <li>{t.step1}</li>
            <li>
              {t.step2}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code
                  data-testid="update-team-command"
                  className="rounded border border-[var(--color-border)] bg-[var(--color-row)] px-3 py-1.5 text-[14px] text-[var(--color-bright)] select-all"
                >
                  {TEAM_UPDATE_COMMAND}
                </code>
                <button type="button" data-testid="update-team-copy" className={buttonClass} onClick={() => void copyCommand()}>
                  {t.copy}
                </button>
                {copy === "copied" && <span role="status" className="text-[13px] text-[var(--color-green)]">{t.copied}</span>}
                {copy === "failed" && <span role="alert" className="text-[13px] text-[var(--color-yellow)]">{t.copyFailed}</span>}
              </div>
            </li>
            <li>{t.step3}</li>
          </ol>
          <p className="m-0 mt-2 text-[13px] leading-5 text-[var(--color-muted)]">{t.server}</p>
          <button type="button" data-testid="update-team-close" className={`mt-3 ${buttonClass}`} onClick={() => setOpen(false)}>
            {t.close}
          </button>
        </section>
      )}
    </div>
  );
}
