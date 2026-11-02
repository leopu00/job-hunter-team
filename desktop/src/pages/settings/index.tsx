import { useEffect, useLayoutEffect, type ComponentType } from "react";
import { appLocale } from "../../lib/app-locale";
import Link from "../../web-shims/next-link";
import type { PageProps } from "../types";
import { AccountSection, AppearanceSection, DataSection, TeamSection, WhereSection } from "./SettingsSections";
import { SECTION_IDS, rememberSection, sectionOf, type SectionId } from "./sections";
import { SECTIONS_TEXT } from "./settings-sections.i18n";
import { SETTINGS_TEXT } from "./settings.i18n";

const SECTION_PAGES: Record<SectionId, ComponentType<PageProps>> = {
  appearance: AppearanceSection,
  team: TeamSection,
  where: WhereSection,
  data: DataSection,
  account: AccountSection,
};

/**
 * /settings/<section>: one page for everything technical that is not about the positions, with its sections
 * in a column on the left (Appearance, Team, Where it runs, Data, Account) and the section on the right. The
 * old addresses of the pages that now live in the sections land here (shell/redirects.ts); `?at=<name>` of
 * those addresses scrolls to the piece they meant. Below a narrow window the column is a row on top.
 */
export default function SettingsPage(props: PageProps) {
  const t = SETTINGS_TEXT[appLocale()];
  const s = SECTIONS_TEXT[appLocale()];
  const section = sectionOf(props.params.section);
  const Section = SECTION_PAGES[section];
  const at = props.search.get("at");

  useEffect(() => rememberSection(section), [section]);
  useLayoutEffect(() => {
    if (!at) return;
    document.getElementById(`settings-at-${at}`)?.scrollIntoView?.({ block: "start" });
  }, [at, section]);

  return (
    <div className="max-w-5xl mx-auto px-5 py-8 flex flex-col gap-4" data-testid="settings-page">
      <h1 id="settings-title" className="text-[15px] font-semibold text-[var(--color-bright)]">{t.title}</h1>
      <div className="flex flex-col md:flex-row gap-5 md:gap-8 items-start">
        <nav
          aria-label={s.navAria}
          data-testid="settings-sections"
          className="flex md:flex-col gap-1 w-full md:w-48 md:shrink-0 overflow-x-auto md:overflow-visible md:sticky md:top-20"
        >
          {SECTION_IDS.map((id) => {
            const active = id === section;
            return (
              <Link
                key={id}
                href={`/settings/${id}`}
                aria-current={active ? "page" : undefined}
                data-testid={`settings-section-${id}`}
                className="px-3 py-1.5 text-[12px] font-semibold rounded whitespace-nowrap no-underline hover:bg-[var(--color-card)] transition-colors"
                style={{
                  color: active ? "var(--color-white)" : "var(--color-muted)",
                  background: active ? "var(--color-card)" : undefined,
                }}
              >
                {s[id]}
              </Link>
            );
          })}
        </nav>
        <section aria-labelledby="settings-title" className="min-w-0 flex-1 w-full flex flex-col gap-4 max-w-3xl">
          <Section {...props} />
        </section>
      </div>
    </div>
  );
}
