import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { DashboardI18nProvider } from "@/app/components/DashboardI18n";
import MainChrome from "@/app/components/MainChrome";
import { DesktopWriteProvider } from "@/lib/desktop-write";
import { ReadOnlyActionsProvider } from "@/lib/read-only-actions";
import {
  existingTeamNotFullReason, existingTeamReadOnlyReason,
  type useExistingTeamReadNotice, type useExistingTeamReadOnly,
} from "../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../lib/existing-team-readonly.i18n";
import { appLocale } from "../lib/app-locale";
import { LeaveReadOnlyContext } from "../lib/leave-read-only";
import { ConnectInFull } from "./ConnectInFull";
import { VpsLinkBar } from "./VpsLinkBar";
import { MailRotationBanner } from "./MailRotationBanner";
import { NewVersionBanner } from "./NewVersionBanner";
import { TeamUpdateNotice } from "./TeamUpdateNotice";
import { TeamOffBanner } from "./TeamOffBanner";
import { ProviderLoginBanner } from "../provider-login/ProviderLoginBanner";
import { LocalTeamOwnerBanner } from "./LocalTeamOwnerBanner";
import { LocalTeamStoppedBar } from "./LocalTeamStoppedBar";
import { WriteAccessRestoredBanner } from "./WriteAccessRestoredBanner";
import { AwayGreeting } from "./AwayGreeting";
import type { ShellProps } from "./Shell";

const FULL_BLEED_COLUMN: CSSProperties = {
  position: "relative", zIndex: 1, display: "flex", flexDirection: "column",
  height: "calc(100svh / var(--zoom, 1))", overflow: "hidden",
};

type FrameProps = { navbar: ReactNode; bars: ReactNode; fullBleed: boolean; children: ReactNode };

/** The same shell layout for linked and local teams, with the same limits on its bars. */
export function ShellFrame({ navbar, bars, fullBleed, children }: FrameProps) {
  if (fullBleed) return (
    <div style={FULL_BLEED_COLUMN}>
      {navbar}
      <div className="shrink-0 max-h-[34%] overflow-y-auto" data-testid="full-bleed-bars">{bars}</div>
      <main className="relative min-h-0 flex-1" data-testid="full-bleed">{children}</main>
    </div>
  );
  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      {navbar}
      {bars}
      <MainChrome>{children}</MainChrome>
    </div>
  );
}

type ProvidersProps = {
  linked: boolean;
  readOnly: ComponentProps<typeof ReadOnlyActionsProvider>["value"];
  onCloseReadOnly?: ShellProps["onCloseReadOnly"];
  children: ReactNode;
};

/** Preserve the provider order of each existing shell mode. */
export function ShellProviders({ linked, readOnly, onCloseReadOnly, children }: ProvidersProps) {
  if (linked) return (
    <DashboardI18nProvider>
      <ReadOnlyActionsProvider value={readOnly}>
        <LeaveReadOnlyContext.Provider value={onCloseReadOnly ?? null}>{children}</LeaveReadOnlyContext.Provider>
      </ReadOnlyActionsProvider>
    </DashboardI18nProvider>
  );
  return (
    <DashboardI18nProvider>
      <DesktopWriteProvider value={{ canChange: true }}>
        <ReadOnlyActionsProvider value={readOnly}>{children}</ReadOnlyActionsProvider>
      </DesktopWriteProvider>
    </DashboardI18nProvider>
  );
}

export function LocalShellBars({ onLogout, identityKey }: Pick<ShellProps, "onLogout" | "identityKey">) {
  return <>
    <MailRotationBanner />
    <NewVersionBanner />
    <TeamUpdateNotice />
    <TeamOffBanner />
    <ProviderLoginBanner />
    <LocalTeamOwnerBanner onSwitch={onLogout} />
    <LocalTeamStoppedBar />
    <WriteAccessRestoredBanner />
    {identityKey && <AwayGreeting identityKey={identityKey} />}
  </>;
}

type LinkedBarsProps = Pick<ShellProps, "onCloseReadOnly" | "onChooseDestination" | "identityKey"> & {
  readOnlyTeam: ReturnType<typeof useExistingTeamReadOnly>;
  readNotice: ReturnType<typeof useExistingTeamReadNotice>;
};

export function LinkedShellBars({ readOnlyTeam, readNotice, onCloseReadOnly, onChooseDestination, identityKey }: LinkedBarsProps) {
  const text = EXISTING_TEAM_READONLY_TEXT[appLocale()];
  const notFullReason = readOnlyTeam ? existingTeamNotFullReason(readOnlyTeam) : null;
  return <>
    {readOnlyTeam && (
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)]">
        <p role="status" data-testid="existing-team-readonly-banner" className="min-w-0 flex-1 text-[11px] text-[var(--color-muted)]">
          <strong className="text-[var(--color-bright)]">{existingTeamReadOnlyReason(readOnlyTeam)}.</strong>{" "}
          {text.banner} <span data-testid="existing-team-judgement-how">{text.judgementHow}</span>
          {notFullReason && <>{" "}<span data-testid="existing-team-readonly-why">{notFullReason}</span></>}
        </p>
        <ConnectInFull />
      </div>
    )}
    {readOnlyTeam && readNotice === "sort_last_action" && (
      <p role="status" data-testid="existing-team-readonly-notice" className="px-4 py-2 text-[11px] text-[var(--color-muted)]">{text.sortLastAction}</p>
    )}
    <VpsLinkBar onCloseReadOnly={onCloseReadOnly} onChooseDestination={onChooseDestination} />
    <WriteAccessRestoredBanner />
    {identityKey && <AwayGreeting identityKey={identityKey} />}
  </>;
}
