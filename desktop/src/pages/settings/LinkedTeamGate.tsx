import { appLocale } from "../../lib/app-locale";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { existingTeamReadOnlyReason, type ExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { LINKED_GATE_TEXT } from "./linked-gate.i18n";

/**
 * What the pages that write to the team say on the read-only link: why they do not open and where to go, so
 * the Team section of Settings never shows a page that would be refused one control at a time. On a team
 * connected in full the section shows the pages themselves (their native command talks to that VPS).
 */
export function LinkedTeamNotice({ readOnly }: { readOnly: ExistingTeamReadOnly }) {
  const t = LINKED_GATE_TEXT[appLocale()];
  const connect = EXISTING_TEAM_READONLY_TEXT[appLocale()].connectInFull;
  return (
    <p role="status" data-testid="linked-gate" className="text-[12px] text-[var(--color-muted)]">
      <strong className="text-[var(--color-bright)]">{existingTeamReadOnlyReason(readOnly)}.</strong>{" "}
      {t.needsFull.replace("{connect}", connect)}
    </p>
  );
}
