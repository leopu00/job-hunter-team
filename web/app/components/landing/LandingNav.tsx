"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLandingI18n, type Lang } from "./LandingI18n";
import { FLAGS } from "@/app/components/LocaleFlags";

const LANGUAGES: {
  code: Lang;
  label: string;
  Flag: () => React.JSX.Element;
}[] = [
  { code: "it", label: "Italiano", Flag: FLAGS.it },
  { code: "en", label: "English", Flag: FLAGS.en },
  { code: "es", label: "Español", Flag: FLAGS.es },
  { code: "fr", label: "Français", Flag: FLAGS.fr },
  { code: "de", label: "Deutsch", Flag: FLAGS.de },
  { code: "pt", label: "Português", Flag: FLAGS.pt },
  { code: "hu", label: "Magyar", Flag: FLAGS.hu },
];

function LangDropdown() {
  const { lang, setLang, t } = useLandingI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const current = LANGUAGES.find((l) => l.code === lang)!;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-0 py-0 transition-all"
        style={{
          cursor: "pointer",
        }}
        aria-label={t("nav_language").replace("{label}", current.label)}
      >
        <current.Flag />
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{
            opacity: 0.5,
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "",
          }}
        >
          <path
            d="M2 4L5 7L8 4"
            stroke="var(--color-muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 overflow-hidden"
          style={{
            background: "var(--color-panel)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            animation: "fade-in 0.15s ease both",
            minWidth: 140,
          }}
        >
          {LANGUAGES.map(({ code, label, Flag }) => (
            <button
              key={code}
              onClick={() => {
                setLang(code);
                setOpen(false);
              }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors"
              style={{
                cursor: "pointer",
                background: code === lang ? "var(--color-card)" : "transparent",
                color:
                  code === lang ? "var(--color-white)" : "var(--color-muted)",
                fontSize: 11,
                fontWeight: code === lang ? 600 : 400,
                fontFamily: "var(--font-mono)",
              }}
            >
              <Flag />
              <span>{label}</span>
              {code === lang && (
                <svg
                  aria-hidden="true"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  className="ml-auto"
                >
                  <path
                    d="M2 5L4 7L8 3"
                    stroke="var(--color-green)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LandingNav() {
  const { t } = useLandingI18n();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinkStyle = (href: string) => ({
    color: pathname === href ? "var(--color-green)" : "var(--color-muted)",
  });
  const currentPage = (href: string) =>
    pathname === href ? ("page" as const) : undefined;

  return (
    <nav
      aria-label={t("nav_main")}
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: "var(--color-void)",
      }}
    >
      <div className="flex items-center justify-between px-5 sm:px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <span className="text-[13px] font-bold tracking-widest text-[var(--color-white)]">
            JHT
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          <Link
            href="/"
            aria-current={currentPage("/")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/")}
          >
            {t("nav_home")}
          </Link>
          <Link
            href="/run"
            aria-current={currentPage("/run")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/run")}
          >
            {t("nav_run")}
          </Link>
          <Link
            href="/download"
            aria-current={currentPage("/download")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/download")}
          >
            {t("nav_download")}
          </Link>
          <Link
            href="/agents"
            aria-current={currentPage("/agents")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/agents")}
          >
            {t("nav_team")}
          </Link>
          <Link
            href="/project"
            aria-current={currentPage("/project")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/project")}
          >
            {t("nav_project")}
          </Link>
          <Link
            href="/setup-guide"
            aria-current={currentPage("/setup-guide")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/setup-guide")}
          >
            {t("nav_get_started")}
          </Link>
          <Link
            href="/case-studies"
            aria-current={currentPage("/case-studies")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/case-studies")}
          >
            {t("nav_case_studies")}
          </Link>
          <Link
            href="/pricing"
            aria-current={currentPage("/pricing")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/pricing")}
          >
            {t("nav_pricing")}
          </Link>
          <a
            href="https://github.com/leopu00/job-hunter-team"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={{ color: "var(--color-muted)" }}
          >
            {t("nav_github")}
          </a>
          <Link
            href="/contact"
            aria-current={currentPage("/contact")}
            className="text-[11px] tracking-wide hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/contact")}
          >
            {t("nav_contact")}
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <LangDropdown />

          <Link
            href="/?login=true"
            className="hidden sm:inline-flex px-0 py-0 text-[11px] font-semibold tracking-wider no-underline transition-colors hover:text-[var(--color-bright)]"
            style={{
              color: "var(--color-green)",
            }}
          >
            {t("nav_login")}
          </Link>

          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden flex flex-col gap-1 p-1.5"
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              cursor: "pointer",
            }}
            aria-label={t("nav_menu")}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-menu"
          >
            <span
              className="block w-4 h-0.5"
              style={{
                background: "var(--color-muted)",
                transition: "all 0.2s",
                transform: mobileOpen
                  ? "rotate(45deg) translate(2px, 2px)"
                  : "",
              }}
            />
            <span
              className="block w-4 h-0.5"
              style={{
                background: "var(--color-muted)",
                transition: "all 0.2s",
                opacity: mobileOpen ? 0 : 1,
              }}
            />
            <span
              className="block w-4 h-0.5"
              style={{
                background: "var(--color-muted)",
                transition: "all 0.2s",
                transform: mobileOpen
                  ? "rotate(-45deg) translate(2px, -2px)"
                  : "",
              }}
            />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          id="mobile-nav-menu"
          role="menu"
          className="md:hidden px-5 pb-4 flex flex-col gap-3"
          style={{
            background: "var(--color-void)",
            animation: "fade-in 0.15s ease both",
          }}
        >
          <Link
            href="/"
            aria-current={currentPage("/")}
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/")}
          >
            {t("nav_home")}
          </Link>
          <Link
            href="/run"
            aria-current={currentPage("/run")}
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/run")}
          >
            {t("nav_run")}
          </Link>
          <Link
            href="/download"
            aria-current={currentPage("/download")}
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/download")}
          >
            {t("nav_download")}
          </Link>
          <Link
            href="/agents"
            aria-current={currentPage("/agents")}
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/agents")}
          >
            {t("nav_team")}
          </Link>
          <Link
            href="/project"
            aria-current={currentPage("/project")}
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/project")}
          >
            {t("nav_project")}
          </Link>
          <Link
            href="/setup-guide"
            aria-current={currentPage("/setup-guide")}
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/setup-guide")}
          >
            {t("nav_get_started")}
          </Link>
          <Link
            href="/case-studies"
            aria-current={currentPage("/case-studies")}
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/case-studies")}
          >
            {t("nav_case_studies")}
          </Link>
          <Link
            href="/pricing"
            aria-current={currentPage("/pricing")}
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={navLinkStyle("/pricing")}
          >
            {t("nav_pricing")}
          </Link>
          <a
            href="https://github.com/leopu00/job-hunter-team"
            target="_blank"
            rel="noreferrer"
            onClick={() => setMobileOpen(false)}
            className="text-[12px] py-3 hover:text-[var(--color-bright)] transition-colors no-underline"
            style={{ color: "var(--color-muted)" }}
          >
            {t("nav_github")}
          </a>
          <Link
            href="/?login=true"
            onClick={() => setMobileOpen(false)}
            className="text-center py-2.5 text-[12px] font-semibold tracking-wider no-underline transition-colors hover:text-[var(--color-bright)]"
            style={{ color: "var(--color-green)" }}
          >
            {t("nav_login")}
          </Link>
        </div>
      )}
    </nav>
  );
}
