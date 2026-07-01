"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDocsNav, type DocLocale } from "./docs-nav";
import { useLandingI18n } from "../components/landing/LandingI18n";

const ARIA_LABEL: Record<DocLocale, string> = {
  it: "Documentazione",
  en: "Documentation",
  es: "Documentación",
  fr: "Documentation",
  de: "Dokumentation",
  hu: "Dokumentáció",
  pt: "Documentação",
};

export default function DocsSidebar() {
  const pathname = usePathname();
  const { lang } = useLandingI18n();
  const nav = getDocsNav(lang as DocLocale);
  return (
    <aside className="hidden md:block fixed top-0 left-0 bottom-0 w-[21rem] z-40 overflow-y-auto border-r border-[var(--color-border)] pt-32 pb-16 pl-6 pr-5">
      <nav
        className="space-y-6"
        aria-label={ARIA_LABEL[lang as DocLocale] ?? ARIA_LABEL.en}
      >
        {nav.map((section) => (
          <div key={section.group}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-dim)] mb-2">
              {section.group}
            </div>
            <ul className="space-y-1.5">
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`block whitespace-nowrap text-[11px] no-underline transition-colors ${
                        active
                          ? "text-[var(--color-white)] font-semibold"
                          : "text-[var(--color-muted)] hover:text-[var(--color-white)]"
                      }`}
                    >
                      {item.emoji ? `${item.emoji} ` : ""}
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
