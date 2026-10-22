import { CurrencyCard, LanguageCard } from "@/app/components/SettingsCloudSections";
import { appLocale } from "../../lib/app-locale";
import type { PageProps } from "../types";
import { SETTINGS_TEXT } from "./settings.i18n";

/**
 * /settings: the app's language and the salary currency, the web's two cards
 * as they are (SettingsCloudSections). The language card posts to /api/i18n,
 * which the shell's bridge answers with the cookie the app reads
 * (shell/api-bridge.ts); the currency card writes its cookie itself. Nothing
 * here reaches the team, so the page is in the read-only view too.
 */
export default function SettingsPage(_props: PageProps) {
  const t = SETTINGS_TEXT[appLocale()];
  return (
    <section className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4" aria-labelledby="settings-title">
      <h1 id="settings-title" className="text-[15px] font-semibold text-[var(--color-bright)]">{t.title}</h1>
      <p className="text-[12px] text-[var(--color-muted)]">{t.intro}</p>
      <LanguageCard />
      <CurrencyCard />
    </section>
  );
}
