import type { ComponentType } from "react";
import { appLocale } from "../../lib/app-locale";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { existingTeamReadOnlyReason, useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { navigate } from "../../shell/router";
import type { PageProps } from "../types";
import { LINKED_GATE_TEXT } from "./linked-gate.i18n";

/**
 * A page that writes to the team, in the routes of the linked VPS's view. On a team connected in full
 * it is the page itself (its native command talks to that VPS); on the read-only link it says why it does
 * not open and where to go, so the address never lands the person on the dashboard without a word.
 */
export function linkedTeamGate(Page: ComponentType<PageProps>): ComponentType<PageProps> {
  return function LinkedTeamGate(props: PageProps) {
    const readOnly = useExistingTeamReadOnly();
    if (!readOnly) return <Page {...props} />;
    const t = LINKED_GATE_TEXT[appLocale()];
    const connect = EXISTING_TEAM_READONLY_TEXT[appLocale()].connectInFull;
    return (
      <section className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4" data-testid="linked-gate">
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="self-start text-[11px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)]"
        >
          ← {t.back}
        </button>
        <p role="status" className="text-[12px] text-[var(--color-muted)]">
          <strong className="text-[var(--color-bright)]">{existingTeamReadOnlyReason(readOnly)}.</strong>{" "}
          {t.needsFull.replace("{connect}", connect)}
        </p>
      </section>
    );
  };
}
