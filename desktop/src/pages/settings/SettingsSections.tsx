import { useEffect, useState, type ReactNode } from "react";
import { CurrencyCard, LanguageCard } from "@/app/components/SettingsCloudSections";
import ReportProblem from "../../components/ReportProblem";
import { appLocale } from "../../lib/app-locale";
import { useExistingTeamReadOnly, useExistingTeamView } from "../../lib/existing-team-readonly";
import { localUninstallAvailable } from "../../lib/local-uninstall";
import { useLocalProfileLink } from "../../lib/local-profile-link";
import { useProviderSetup } from "../../lib/provider-setup";
import ThemePicker from "../../shell/ThemePicker";
import BackupPage from "../backup";
import ComputerPage from "../computer";
import ExportPage from "../export";
import TeamSettingsPage from "../team-settings";
import type { PageProps } from "../types";
import VpsConnectionPage from "../vps-connection";
import WorkHoursPage from "../work-hours";
import AccountCard from "./AccountCard";
import { EmbeddedContext } from "./embedded";
import { LinkedTeamNotice } from "./LinkedTeamGate";
import NotifyCard from "./NotifyCard";
import ProviderSignOut from "./ProviderSignOut";
import TeamCard from "./TeamCard";
import UpdateCheckCard from "./UpdateCheckCard";
import { SECTIONS_TEXT } from "./settings-sections.i18n";
import { SETTINGS_TEXT } from "./settings.i18n";

const cardCls = "rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2";
const smallButtonCls =
  "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]";

/** A page of the technical set, shown inside a section: where `?at=<name>` of the old addresses scrolls to. */
function At({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div id={`settings-at-${name}`} data-testid={`settings-at-${name}`} className="settings-embedded">
      <EmbeddedContext.Provider value={true}>{children}</EmbeddedContext.Provider>
    </div>
  );
}

const NO_PROPS: PageProps = { params: {}, search: new URLSearchParams() };

/** Aspetto: how the app looks and speaks. Nothing here reaches the team. */
export function AppearanceSection(_props: PageProps) {
  const t = SETTINGS_TEXT[appLocale()];
  const s = SECTIONS_TEXT[appLocale()];
  return (
    <>
      <p className="text-[12px] text-[var(--color-muted)]">{t.intro}</p>
      <section data-testid="settings-theme" aria-labelledby="settings-theme-title" className={cardCls}>
        <h2 id="settings-theme-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{s.themeTitle}</h2>
        <p className="text-[12px] text-[var(--color-muted)]">{s.themeText}</p>
        <div><ThemePicker /></div>
      </section>
      <LanguageCard />
      <CurrencyCard />
      <NotifyCard />
    </>
  );
}

/** Squadra: the team's state and pace, its hours, its models and its provider. */
export function TeamSection(_props: PageProps) {
  const t = SETTINGS_TEXT[appLocale()];
  const providerSetup = useProviderSetup();
  // the team's hours and models are written to the team: not in the read-only view
  const readOnly = useExistingTeamReadOnly();
  return (
    <>
      <TeamCard readOnly={readOnly !== null} />
      {readOnly ? (
        <LinkedTeamNotice readOnly={readOnly} />
      ) : (
        <>
          <At name="hours"><WorkHoursPage {...NO_PROPS} /></At>
          <At name="models"><TeamSettingsPage {...NO_PROPS} /></At>
        </>
      )}
      {providerSetup && (
        <section data-testid="settings-provider" aria-labelledby="settings-provider-title" className={cardCls}>
          <h2 id="settings-provider-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.providerTitle}</h2>
          <p className="text-[12px] text-[var(--color-muted)]">{t.providerText}</p>
          <div>
            <button type="button" onClick={providerSetup.open} className={smallButtonCls}>{t.providerButton}</button>
          </div>
          <ProviderSignOut />
        </section>
      )}
    </>
  );
}

/** Dove gira: this computer or the linked VPS. */
export function WhereSection(_props: PageProps) {
  return (
    <At name="vps">
      <VpsConnectionPage {...NO_PROPS} />
    </At>
  );
}

/** Dati: the backup, the export and, where it can run, the removal of JHT from this computer. */
export function DataSection(_props: PageProps) {
  const [computer, setComputer] = useState(false);
  // removing JHT from this computer is not offered in the view of a team on a VPS
  const linked = useExistingTeamView() !== null;
  useEffect(() => {
    let active = true;
    void localUninstallAvailable().then((yes) => { if (active) setComputer(yes); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return (
    <>
      {/* making a backup and exporting only read the team: offered in the read-only view too */}
      <At name="backup"><BackupPage {...NO_PROPS} /></At>
      <At name="export"><ExportPage {...NO_PROPS} /></At>
      {computer && !linked && <At name="uninstall"><ComputerPage {...NO_PROPS} /></At>}
    </>
  );
}

/** Account: who is signed in, the updates, the report of a problem and the local profile that is not linked. */
export function AccountSection(_props: PageProps) {
  const t = SETTINGS_TEXT[appLocale()];
  const localProfileLink = useLocalProfileLink();
  return (
    <>
      <AccountCard />
      <UpdateCheckCard />
      {localProfileLink && (
        <section data-testid="settings-local-link" aria-labelledby="settings-local-link-title" className={cardCls}>
          <h2 id="settings-local-link-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.localLinkTitle}</h2>
          <p className="text-[12px] text-[var(--color-muted)]">{t.localLinkText}</p>
          <div>
            <button type="button" onClick={() => localProfileLink.link()} className={smallButtonCls}>{t.localLinkButton}</button>
          </div>
        </section>
      )}
      <ReportProblem id="settings-report" />
    </>
  );
}
