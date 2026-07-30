"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useDashboardT } from "@/app/components/DashboardI18n";
import { useLocale } from "@/lib/use-locale";

type Pending = { profile: boolean; team: boolean };
const PENDING_KEY = "onboarding-popup:pending";
const EVENT_NAME = "onboarding-popup-update";

const T: Record<string, Record<string, string>> = {
  setup_pending: {
    it: "configurazione in sospeso",
    en: "setup pending",
    hu: "beállítás függőben",
    es: "configuración pendiente",
    de: "Einrichtung ausstehend",
    fr: "configuration en attente",
    pt: "configuração pendente",
  },
};

export default function NavLinks() {
  const { t } = useDashboardT();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const pathname = usePathname() ?? "";
  const [pending, setPending] = useState<Pending>({
    profile: false,
    team: false,
  });

  useEffect(() => {
    const read = (): Pending => {
      try {
        const raw = sessionStorage.getItem(PENDING_KEY);
        if (!raw) return { profile: false, team: false };
        const v = JSON.parse(raw);
        return { profile: !!v.profile, team: !!v.team };
      } catch {
        return { profile: false, team: false };
      }
    };
    setPending(read());
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<Pending>).detail;
      if (detail) setPending(detail);
      else setPending(read());
    };
    window.addEventListener(EVENT_NAME, onUpdate);
    return () => window.removeEventListener(EVENT_NAME, onUpdate);
  }, []);

  return (
    <div className="flex items-center gap-1">
      <NavLink href="/dashboard" pathname={pathname} tour="dashboard">
        {t("nav_dashboard")}
      </NavLink>
      <NavLink href="/map" pathname={pathname}>
        {t("nav_map")}
      </NavLink>
      <NavLink href="/positions" pathname={pathname} tour="positions">
        {t("nav_positions")}
      </NavLink>
      <NavLink href="/swipe" pathname={pathname}>
        {t("nav_swipe")}
      </NavLink>
      <NavLink
        href="/team"
        pathname={pathname}
        tour="team"
        badge={pending.team}
        badgeLabel={tr("setup_pending")}
      >
        {t("nav_team")}
      </NavLink>
      <NavLink href="/messages" pathname={pathname}>
        {t("nav_messages")}
      </NavLink>
      <NavLink
        href="/profile"
        pathname={pathname}
        badge={pending.profile}
        badgeLabel={tr("setup_pending")}
      >
        {t("nav_profile")}
      </NavLink>
    </div>
  );
}

function NavLink({
  href,
  children,
  accent,
  tour,
  pathname,
  badge,
  badgeLabel,
}: {
  href: string;
  children: React.ReactNode;
  accent?: string;
  tour?: string;
  pathname: string;
  badge?: boolean;
  badgeLabel?: string;
}) {
  // Active quando il pathname è esattamente la voce o un suo sotto-percorso
  // (es. /team/log mantiene "Team" attivo). Stato attivo = colore bianco
  // sovrascrivendo l'accent della voce (dev3 commit 06def336).
  const active = pathname === href || pathname.startsWith(href + "/");
  const color = active
    ? "var(--color-white)"
    : (accent ?? "var(--color-muted)");

  return (
    <Link
      href={href}
      data-tour={tour}
      aria-current={active ? "page" : undefined}
      // `relative` + `inline-block` necessari per posizionare il badge "!"
      // assoluto top-right su Team/Profile quando setup pending
      // (dev2 commit 070f97f8). `uppercase` rimosso intenzionalmente
      // (dev3 polish UI).
      className="relative px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] rounded transition-colors no-underline inline-block"
      style={{ color } as React.CSSProperties}
    >
      {children}
      {badge && (
        <span
          aria-label={badgeLabel ?? "setup pending"}
          className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-3 h-3 rounded-full text-[8px] font-bold leading-none"
          style={{
            background: "var(--color-yellow)",
            color: "#1a1500",
          }}
        >
          !
        </span>
      )}
    </Link>
  );
}
