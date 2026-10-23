import { useState } from "react";
import { appLocale } from "../lib/app-locale";
import { EXISTING_TEAM_READONLY_TEXT } from "../lib/existing-team-readonly.i18n";
import { useReconfirmExistingTeam } from "../lib/reconfirm-existing-team";
import ExistingTeamReconfirmDialog from "../pages/messages/ExistingTeamReconfirmDialog";

/**
 * «Collega in scrittura», in the read-only banner: the same «Collega il team» → «Conferma e collega»
 * as the chat's, for the host and team this profile saved (the dialog and its checks are the chat's:
 * the native side asks for the app's own window and the full link). It opens only on the person's
 * click. Without the dashboard's confirmation (an older shell) there is nothing to open: no button.
 */
export function ConnectInFull() {
  const reconfirm = useReconfirmExistingTeam();
  const [open, setOpen] = useState(false);
  if (!reconfirm) return null;
  const text = EXISTING_TEAM_READONLY_TEXT[appLocale()];
  return (
    <>
      <button
        type="button"
        data-testid="existing-team-connect-in-full"
        onClick={() => setOpen(true)}
        className="shrink-0 text-[10px] font-semibold tracking-widest uppercase px-2 xl:px-3 py-1.5 rounded border border-[var(--color-border)] transition-colors text-[var(--color-muted)] hover:text-[var(--color-bright)] cursor-pointer"
      >
        {text.connectInFull}
      </button>
      {open && <ExistingTeamReconfirmDialog reconfirm={reconfirm} onClose={() => setOpen(false)} />}
    </>
  );
}
