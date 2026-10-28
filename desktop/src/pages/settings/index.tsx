import { CurrencyCard, LanguageCard } from "@/app/components/SettingsCloudSections";
import { appLocale } from "../../lib/app-locale";
import { navigate } from "../../shell/router";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { useProviderSetup } from "../../lib/provider-setup";
import { useLocalProfileLink } from "../../lib/local-profile-link";
import type { PageProps } from "../types";
import { BACKUP_TEXT } from "../backup/backup.i18n";
import { EXPORT_TEXT } from "../export/export.i18n";
import { TEAM_SETTINGS_TEXT } from "../team-settings/team-settings.i18n";
import { WORK_HOURS_TEXT } from "../work-hours/work-hours.i18n";
import AccountCard from "./AccountCard";
import NotifyCard from "./NotifyCard";
import TeamCard from "./TeamCard";
import UpdateCheckCard from "./UpdateCheckCard";
import { SETTINGS_TEXT, VPS_CONNECTION_TEXT } from "./settings.i18n";

/**
 * /settings: the app's language and the salary currency, the web's two cards
 * as they are (SettingsCloudSections). The language card posts to /api/i18n,
 * which the shell's bridge answers with the cookie the app reads
 * (shell/api-bridge.ts); the currency card writes its cookie itself. Nothing
 * here reaches the team, so the page is in the read-only view too. The one card that does, «Provider»,
 * is there only for the team of this computer once its setup is done (lib/provider-setup.ts): it
 * reopens the setup's own Provider step.
 */
export default function SettingsPage(_props: PageProps) {
  const t = SETTINGS_TEXT[appLocale()];
  const providerSetup = useProviderSetup();
  const localProfileLink = useLocalProfileLink();
  // the team's hours and models are written to the team: not in the read-only view
  const readOnly = useExistingTeamReadOnly() !== null;
  const team = TEAM_SETTINGS_TEXT[appLocale()];
  const hours = WORK_HOURS_TEXT[appLocale()];
  const exportText = EXPORT_TEXT[appLocale()];
  const backupText = BACKUP_TEXT[appLocale()];
  return (
    <section className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4" aria-labelledby="settings-title">
      <h1 id="settings-title" className="text-[15px] font-semibold text-[var(--color-bright)]">{t.title}</h1>
      <p className="text-[12px] text-[var(--color-muted)]">{t.intro}</p>
      <AccountCard />
      <TeamCard readOnly={readOnly} />
      <LanguageCard />
      <CurrencyCard />
      <NotifyCard />
      <UpdateCheckCard />
      <button
        type="button"
        onClick={() => navigate("/settings/vps-connection")}
        className="text-left rounded border border-[var(--color-border)] px-4 py-3 hover:border-[var(--color-border-glow)]"
      >
        <span className="block text-[13px] font-semibold text-[var(--color-bright)]">{VPS_CONNECTION_TEXT[appLocale()].link}</span>
        <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{VPS_CONNECTION_TEXT[appLocale()].linkNote}</span>
      </button>
      {/* the hours page is not in the read-only view, but what a hours file that cannot be read means is */}
      {readOnly && (
        <p className="text-[11px] text-[var(--color-yellow)]" data-testid="settings-hours-unreadable">
          {hours.unreadable}
        </p>
      )}
      {!readOnly && (
        <button
          type="button"
          data-testid="settings-hours-link"
          onClick={() => navigate("/settings/hours")}
          className="text-left rounded border border-[var(--color-border)] px-4 py-3 hover:border-[var(--color-border-glow)]"
        >
          <span className="block text-[13px] font-semibold text-[var(--color-bright)]">{hours.link}</span>
          <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{hours.linkNote}</span>
        </button>
      )}
      {!readOnly && (
        <button
          type="button"
          data-testid="settings-team-link"
          onClick={() => navigate("/settings/team")}
          className="text-left rounded border border-[var(--color-border)] px-4 py-3 hover:border-[var(--color-border-glow)]"
        >
          <span className="block text-[13px] font-semibold text-[var(--color-bright)]">{team.link}</span>
          <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{team.linkNote}</span>
        </button>
      )}
      {/* exporting only reads: offered in the read-only view too */}
      <button
        type="button"
        data-testid="settings-export-link"
        onClick={() => navigate("/export")}
        className="text-left rounded border border-[var(--color-border)] px-4 py-3 hover:border-[var(--color-border-glow)]"
      >
        <span className="block text-[13px] font-semibold text-[var(--color-bright)]">{exportText.link}</span>
        <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{exportText.linkNote}</span>
      </button>
      {/* making a backup only reads the team: offered in the read-only view too */}
      <button
        type="button"
        data-testid="settings-backup-link"
        onClick={() => navigate("/backup")}
        className="text-left rounded border border-[var(--color-border)] px-4 py-3 hover:border-[var(--color-border-glow)]"
      >
        <span className="block text-[13px] font-semibold text-[var(--color-bright)]">{backupText.link}</span>
        <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{backupText.linkNote}</span>
      </button>
      {localProfileLink && (
        <section
          data-testid="settings-local-link"
          aria-labelledby="settings-local-link-title"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2"
        >
          <h2 id="settings-local-link-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.localLinkTitle}</h2>
          <p className="text-[12px] text-[var(--color-muted)]">{t.localLinkText}</p>
          <div>
            <button
              type="button"
              onClick={() => localProfileLink.link()}
              className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
            >
              {t.localLinkButton}
            </button>
          </div>
        </section>
      )}
      {providerSetup && (
        <section
          data-testid="settings-provider"
          aria-labelledby="settings-provider-title"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2"
        >
          <h2 id="settings-provider-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.providerTitle}</h2>
          <p className="text-[12px] text-[var(--color-muted)]">{t.providerText}</p>
          <div>
            <button
              type="button"
              onClick={providerSetup.open}
              className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
            >
              {t.providerButton}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
