"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useDashboardT } from "@/app/components/DashboardI18n";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<Locale, { menuAria: string }> = {
  it: { menuAria: "Menu navigazione" },
  en: { menuAria: "Navigation menu" },
  es: { menuAria: "Menú de navegación" },
  fr: { menuAria: "Menu de navigation" },
  de: { menuAria: "Navigationsmenü" },
  hu: { menuAria: "Navigációs menü" },
  pt: { menuAria: "Menu de navegação" },
};

const NAV_KEYS: { href: string; key: string; accent?: string }[] = [
  { href: "/dashboard", key: "nav_dashboard" },
  { href: "/map", key: "nav_map" },
  { href: "/positions", key: "nav_positions" },
  { href: "/swipe", key: "nav_swipe" },
  { href: "/team", key: "nav_team" },
  { href: "/messages", key: "nav_messages" },
  { href: "/profile", key: "nav_profile" },
];

export default function NavbarMobile() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { t } = useDashboardT();
  const tl = T[useLocale()];

  return (
    <div className="md:hidden flex items-center">
      {/* Barrette posizionate in assoluto e ruotate attorno al CENTRO del
          bottone: col vecchio flex+translate la X usciva dal bordo e
          risultava tagliata. */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-7 h-7 rounded"
        style={{
          background: "none",
          border: "1px solid var(--color-border)",
          cursor: "pointer",
        }}
        aria-label={tl.menuAria}
        aria-expanded={open}
        aria-controls="app-mobile-nav"
      >
        <span
          className="absolute left-1/2 top-1/2 block w-4 h-0.5 rounded-full"
          style={{
            background: "var(--color-bright)",
            transition: "transform 0.2s",
            transform: open
              ? "translate(-50%, -50%) rotate(45deg)"
              : "translate(-50%, calc(-50% - 5px))",
          }}
        />
        <span
          className="absolute left-1/2 top-1/2 block w-4 h-0.5 rounded-full"
          style={{
            background: "var(--color-bright)",
            transition: "opacity 0.2s",
            transform: "translate(-50%, -50%)",
            opacity: open ? 0 : 1,
          }}
        />
        <span
          className="absolute left-1/2 top-1/2 block w-4 h-0.5 rounded-full"
          style={{
            background: "var(--color-bright)",
            transition: "transform 0.2s",
            transform: open
              ? "translate(-50%, -50%) rotate(-45deg)"
              : "translate(-50%, calc(-50% + 5px))",
          }}
        />
      </button>

      {open && (
        <div
          id="app-mobile-nav"
          role="menu"
          className="absolute top-full left-0 right-0 flex flex-col border-b border-[var(--color-border)]"
          style={{
            background: "var(--color-panel)",
            animation: "fade-in 0.15s ease both",
            zIndex: 50,
          }}
        >
          {NAV_KEYS.map(({ href, key, accent }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="px-5 py-3 text-[12px] font-semibold tracking-wide no-underline border-b border-[var(--color-border)] last:border-b-0 transition-colors hover:bg-[var(--color-card)]"
                style={{
                  color: active
                    ? "var(--color-green)"
                    : (accent ?? "var(--color-muted)"),
                }}
              >
                {t(key)}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
