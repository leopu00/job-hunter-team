import { CurrencyCard, LanguageCard } from "@/app/components/SettingsCloudSections";
import { appLocale } from "../../lib/app-locale";
import { navigate } from "../../shell/router";
import { useProviderSetup } from "../../lib/provider-setup";
import type { PageProps } from "../types";
import NotifyCard from "./NotifyCard";
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
  return (
    <section className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4" aria-labelledby="settings-title">
      <h1 id="settings-title" className="text-[15px] font-semibold text-[var(--color-bright)]">{t.title}</h1>
      <p className="text-[12px] text-[var(--color-muted)]">{t.intro}</p>
      <LanguageCard />
      <CurrencyCard />
      <NotifyCard />
      <button
        type="button"
        onClick={() => navigate("/settings/vps-connection")}
        className="text-left rounded border border-[var(--color-border)] px-4 py-3 hover:border-[var(--color-border-glow)]"
      >
        <span className="block text-[13px] font-semibold text-[var(--color-bright)]">{VPS_CONNECTION_TEXT[appLocale()].link}</span>
        <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{VPS_CONNECTION_TEXT[appLocale()].linkNote}</span>
      </button>
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
