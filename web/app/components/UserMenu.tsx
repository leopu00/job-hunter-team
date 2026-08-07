"use client";

import { useState, useRef, useEffect, lazy, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// Caricato solo quando serve: il modulo di segnalazione non deve pesare sul
// primo caricamento della dashboard di chi non lo aprirà mai.
const SupportDialog = lazy(() => import("./SupportDialog"));

type UserMenuStrings = {
  accountPrefix: string;
  profile: string;
  settings: string;
  exportData: string;
  legal: string;
  backup: string;
  logout: string;
  connectTeam: string;
  support: string;
};

const T: Record<Locale, UserMenuStrings> = {
  it: {
    accountPrefix: "Account:",
    profile: "Profilo",
    settings: "Impostazioni",
    exportData: "Esporta dati",
    legal: "Privacy e termini",
    backup: "Backup",
    logout: "Esci",
    connectTeam: "Collega il tuo team",
    support: "Segnala un problema",
  },
  en: {
    accountPrefix: "Account:",
    profile: "Profile",
    settings: "Settings",
    exportData: "Export data",
    legal: "Privacy & terms",
    backup: "Backup",
    logout: "Sign out",
    connectTeam: "Connect your team",
    support: "Report a problem",
  },
  es: {
    accountPrefix: "Cuenta:",
    profile: "Perfil",
    settings: "Ajustes",
    exportData: "Exportar datos",
    legal: "Privacidad y términos",
    backup: "Copia de seguridad",
    logout: "Cerrar sesión",
    connectTeam: "Conecta tu equipo",
    support: "Informar de un problema",
  },
  fr: {
    accountPrefix: "Compte :",
    profile: "Profil",
    settings: "Paramètres",
    exportData: "Exporter les données",
    legal: "Confidentialité et conditions",
    backup: "Sauvegarde",
    logout: "Se déconnecter",
    connectTeam: "Connecter votre équipe",
    support: "Signaler un problème",
  },
  de: {
    accountPrefix: "Konto:",
    profile: "Profil",
    settings: "Einstellungen",
    exportData: "Daten exportieren",
    legal: "Datenschutz & Bedingungen",
    backup: "Sicherung",
    logout: "Abmelden",
    connectTeam: "Team verbinden",
    support: "Problem melden",
  },
  hu: {
    accountPrefix: "Fiók:",
    profile: "Profil",
    settings: "Beállítások",
    exportData: "Adatok exportálása",
    legal: "Adatvédelem és feltételek",
    backup: "Biztonsági mentés",
    logout: "Kijelentkezés",
    connectTeam: "Csapat összekapcsolása",
    support: "Hiba jelentése",
  },
  pt: {
    accountPrefix: "Conta:",
    profile: "Perfil",
    settings: "Configurações",
    exportData: "Exportar dados",
    legal: "Privacidade e termos",
    backup: "Backup",
    logout: "Sair",
    connectTeam: "Liga a tua equipa",
    support: "Comunicar um problema",
  },
};

interface UserMenuProps {
  avatarUrl?: string;
  fullName?: string;
  email: string;
  // [JHT-WEB-DEMO] true = nessun dato sincronizzato: voce "Collega il tuo
  // team" in cima al menu + pallino sull'avatar, finché il pairing non
  // avviene (promemoria onboarding, 22/07).
  needsPairing?: boolean;
}

export default function UserMenu({
  avatarUrl,
  fullName,
  email,
  needsPairing,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [supporto, setSupporto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = T[useLocale()];
  // [JHT-DASHBOARD-SPLIT] Sul cloud le voci di controllo/config sono redirette
  // dal layout: qui le nascondiamo dal menu per non offrire vicoli ciechi.
  // (null/false = locale → mostra tutto; true = cloud → nascondi.)
  const isCloud = useIsCloud();

  const initials = fullName
    ? fullName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : email
      ? email.slice(0, 2).toUpperCase()
      : "?";

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`${t.accountPrefix} ${fullName ?? email}`}
        aria-expanded={open}
        className="w-8 h-8 rounded-full overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)] flex items-center justify-center cursor-pointer hover:border-[var(--color-green)] transition-colors"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={fullName ?? "avatar"}
            width={32}
            height={32}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-[11px] font-bold text-[var(--color-green)]">
            {initials}
          </span>
        )}
      </button>
      {needsPairing && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-panel)]"
          style={{ background: "var(--color-green)" }}
        />
      )}

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 min-w-[220px] overflow-hidden z-50"
          style={{
            background: "var(--color-panel)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            animation: "fade-in 0.15s ease both",
          }}
        >
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="text-[12px] font-medium text-[var(--color-bright)] truncate">
              {fullName ?? email.split("@")[0]}
            </div>
            <div className="text-[10px] text-[var(--color-dim)] truncate mt-0.5">
              {email}
            </div>
          </div>
          {needsPairing && (
            <Link
              href="/welcome"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-[11px] font-semibold hover:bg-[var(--color-card)] transition-colors no-underline"
              style={{ color: "var(--color-green)" }}
            >
              <span
                aria-hidden
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--color-green)" }}
              />
              {t.connectTeam}
            </Link>
          )}
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-card)] transition-colors no-underline"
          >
            {t.profile}
          </Link>
          {/* Impostazioni SEMPRE visibile (reintegrata 20/07): sul cloud la
              pagina mostra solo le sezioni utili lì (tema + cloud-sync). */}
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-card)] transition-colors no-underline"
          >
            {t.settings}
          </Link>
          {/* Export legge i file locali di JHT_HOME: sul cloud produrrebbe
              solo dataset vuoti → nascosto come Backup (niente vicoli ciechi). */}
          {isCloud !== true && (
            <Link
              href="/export"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-card)] transition-colors no-underline"
            >
              {t.exportData}
            </Link>
          )}
          {isCloud !== true && (
            <Link
              href="/backup"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-card)] transition-colors no-underline"
            >
              {t.backup}
            </Link>
          )}
          {/* Privacy e termini sono raggiungibili dal footer di ogni pagina
              pubblica, ma l'area riservata non ha footer: chi è dentro non
              aveva alcun percorso verso i due documenti. */}
          <Link
            href="/privacy"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-card)] transition-colors no-underline border-t border-[var(--color-border)]"
          >
            {t.legal}
          </Link>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setSupporto(true);
            }}
            className="w-full text-left px-4 py-2 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-card)] transition-colors cursor-pointer border-t border-[var(--color-border)]"
          >
            {t.support}
          </button>
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2.5 text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-red)] hover:bg-[var(--color-card)] transition-colors cursor-pointer border-t border-[var(--color-border)] mt-1"
          >
            {t.logout}
          </button>
        </div>
      )}

      {supporto && (
        <Suspense fallback={null}>
          <SupportDialog onClose={() => setSupporto(false)} />
        </Suspense>
      )}
    </div>
  );
}
