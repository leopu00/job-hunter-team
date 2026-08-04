"use client";

import Link from "next/link";
import { useLandingI18n } from "./LandingI18n";
import { useTheme, type Theme } from "../../theme-provider";

// Switcher tema compatto per il footer: sistema / notte / giorno (testo).
function FooterThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const { t } = useLandingI18n();
  const OPTIONS: { value: Theme; labelKey: string }[] = [
    { value: "system", labelKey: "theme_system" },
    { value: "dark", labelKey: "theme_dark" },
    { value: "light", labelKey: "theme_light" },
  ];
  return (
    <div
      className="flex items-center gap-2.5"
      role="radiogroup"
      aria-label={t("theme_aria")}
    >
      {OPTIONS.map(({ value, labelKey }) => {
        const active = theme === value;
        const label = t(labelKey as Parameters<typeof t>[0]);
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            role="radio"
            aria-checked={active}
            aria-label={label}
            className="text-[9px] leading-none cursor-pointer transition-colors bg-transparent border-0 p-0"
            style={{
              color: active ? "var(--color-green)" : "var(--color-dim)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function LandingCTA() {
  const { t } = useLandingI18n();

  return (
    <section
      aria-label={t("cta_section_aria")}
      id="cta"
      className="px-6 py-20 text-center max-w-2xl mx-auto"
    >
      <h2 className="text-xl md:text-2xl font-bold text-[var(--color-white)] tracking-tight mb-6">
        {t("cta_title_1")} {t("cta_title_2")}
      </h2>
      <Link
        href="/run"
        className="inline-block px-8 py-3.5 rounded text-[13px] font-bold tracking-wider no-underline transition-all"
        style={{
          background: "var(--color-green)",
          color: "#060608",
        }}
      >
        {t("cta_button")}
      </Link>
    </section>
  );
}

export function LandingFooter() {
  const { t } = useLandingI18n();
  const linkClass =
    "text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors no-underline block py-0.5";

  return (
    <footer
      role="contentinfo"
      aria-label={t("footer_aria")}
      className="px-6 pt-12 pb-8 border-t border-[var(--color-border)]"
    >
      <div className="max-w-5xl mx-auto">
        {/* Columns */}
        <nav
          aria-label={t("footer_links_aria")}
          className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-4"
        >
          {/* Brand */}
          <div>
            <div className="flex items-center mb-3">
              <span className="text-[11px] font-bold tracking-widest text-[var(--color-muted)]">
                JHT
              </span>
            </div>
            <p className="text-[10px] text-[var(--color-dim)] leading-relaxed">
              {t("footer_brand_desc")}
            </p>
            <div className="mt-4">
              <FooterThemeSwitch />
            </div>
          </div>

          {/* Prodotto */}
          <div>
            <h4 className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-muted)] mb-3">
              {t("footer_product")}
            </h4>
            <Link href="/run" className={linkClass}>
              {t("nav_run")}
            </Link>
            <Link href="/download" className={linkClass}>
              {t("nav_download")}
            </Link>
            <Link href="/project" className={linkClass}>
              {t("footer_stats")}
            </Link>
            <Link href="/tutorials" className={linkClass}>
              {t("footer_tutorials")}
            </Link>
            <a
              href="https://github.com/leopu00/job-hunter-team/blob/master/CHANGELOG.md"
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              Changelog
            </a>
          </div>

          {/* Risorse */}
          <div>
            <h4 className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-muted)] mb-3">
              {t("footer_resources")}
            </h4>
            <Link href="/docs" className={linkClass}>
              Docs
            </Link>
            <a
              href="https://github.com/leopu00/job-hunter-team"
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              GitHub
            </a>
            <a href="/sitemap.xml" className={linkClass}>
              Sitemap
            </a>
          </div>

          {/* Contatti */}
          <div>
            <h4 className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-muted)] mb-3">
              {t("footer_contacts")}
            </h4>
            <Link href="/contact" className={linkClass}>
              {t("nav_contact")}
            </Link>
            <a
              href="https://github.com/leopu00/job-hunter-team/issues"
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              {t("footer_bug")}
            </a>
            <Link href="/privacy" className={linkClass}>
              {t("footer_privacy")}
            </Link>
            <Link href="/terms" className={linkClass}>
              {t("footer_terms")}
            </Link>
          </div>
        </nav>

        {/* Bottom bar */}
        <div className="pt-6 border-t border-[var(--color-border)] flex flex-col md:flex-row items-center justify-between gap-3">
          <span className="text-[9px] text-[var(--color-dim)]">
            &copy; {new Date().getFullYear()} Job Hunter Team &mdash;{" "}
            {t("footer_copyright")}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-[var(--color-dim)]">
              Made with ❤️ by{" "}
              <a
                href="https://github.com/leopu00"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-muted)] hover:text-[var(--color-green)] no-underline"
              >
                leopu00
              </a>
            </span>
            <span className="text-[9px] text-[var(--color-dim)]">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
