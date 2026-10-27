import { useDashboardT } from "@/app/components/DashboardI18n";
import { appLocale } from "../../lib/app-locale";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { fill } from "../../lib/text-slots";
import { SHELL_TEXT } from "../../shell/shell.i18n";
import PublicPageLinks from "../../components/PublicPageLinks";
import type { PageProps } from "../types";
import { HELP_TEXT } from "./help.i18n";

/**
 * /help: what the app does today, for a team on this computer or on a VPS. The page
 * names are the navigation's own (the dashboard's dictionary for the web's
 * three, the read-only view's for the rest), and the two buttons the trouble
 * paragraph names are the navbar's.
 */
export default function HelpPage(_props: PageProps) {
  const locale = appLocale();
  const t = HELP_TEXT[locale];
  const names = EXISTING_TEAM_READONLY_TEXT[locale];
  const { t: dashboardT } = useDashboardT();
  const label = {
    dashboard: dashboardT("nav_dashboard"),
    map: dashboardT("nav_map"),
    positions: dashboardT("nav_positions"),
    team: names.team,
    profile: names.profile,
    office: names.office,
    agents: names.agents,
    settings: names.settings,
  };
  return (
    <article className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4 text-[12px] leading-relaxed" aria-labelledby="help-title">
      <h1 id="help-title" className="text-[15px] font-semibold text-[var(--color-bright)]">{t.title}</h1>
      <p className="text-[var(--color-muted)]">{t.intro}</p>

      <section aria-labelledby="help-what" className="flex flex-col gap-1">
        <h2 id="help-what" className="text-[13px] font-semibold">{t.whatTitle}</h2>
        <p>{t.what}</p>
      </section>

      <section aria-labelledby="help-pages" className="flex flex-col gap-2">
        <h2 id="help-pages" className="text-[13px] font-semibold">{t.pagesTitle}</h2>
        <dl className="flex flex-col gap-2">
          {(Object.keys(t.pages) as (keyof typeof t.pages)[]).map((page) => (
            <div key={page}>
              <dt className="font-semibold">{label[page]}</dt>
              <dd className="m-0 text-[var(--color-muted)]">{t.pages[page]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="help-readonly" className="flex flex-col gap-1">
        <h2 id="help-readonly" className="text-[13px] font-semibold">{t.readOnlyTitle}</h2>
        {t.readOnly.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </section>

      <section aria-labelledby="help-trouble" className="flex flex-col gap-1">
        <h2 id="help-trouble" className="text-[13px] font-semibold">{t.troubleTitle}</h2>
        <p>{fill(t.trouble, { refresh: SHELL_TEXT[locale].refresh, back: names.back })}</p>
      </section>

      <PublicPageLinks className="m-0 text-[var(--color-muted)]" />
    </article>
  );
}
