"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  h1_pre: {
    it: "Sincronizzazione ",
    en: "Cloud ",
    hu: "Felhő-",
    es: "Sincronización ",
    de: "Cloud-",
    fr: "Synchronisation ",
    pt: "Sincronização ",
  },
  h1_accent: {
    it: "cloud",
    en: "sync",
    hu: "szinkronizálás",
    es: "en la nube",
    de: "Synchronisierung",
    fr: "cloud",
    pt: "na nuvem",
  },
  subtitle: {
    it: "Collega un account per accedere al profilo da altri dispositivi. Facoltativo.",
    en: "Link an account to access your profile from other devices. Optional.",
    hu: "Csatlakoztass egy fiókot, hogy más eszközökről is elérd a profilodat. Választható.",
    es: "Vincula una cuenta para acceder a tu perfil desde otros dispositivos. Opcional.",
    de: "Verknüpfe ein Konto, um von anderen Geräten auf dein Profil zuzugreifen. Optional.",
    fr: "Liez un compte pour accéder à votre profil depuis d'autres appareils. Facultatif.",
    pt: "Liga uma conta para aceder ao teu perfil a partir de outros dispositivos. Opcional.",
  },
  link_account: {
    it: "Collega account",
    en: "Link account",
    hu: "Fiók csatlakoztatása",
    es: "Vincular cuenta",
    de: "Konto verknüpfen",
    fr: "Lier un compte",
    pt: "Ligar conta",
  },
  continue_without: {
    it: "Continua senza",
    en: "Continue without",
    hu: "Folytatás nélküle",
    es: "Continuar sin",
    de: "Ohne fortfahren",
    fr: "Continuer sans",
    pt: "Continuar sem",
  },
};

// Step finale dell'onboarding: scelta sync cloud o locale. NON è una pagina
// di login — è una pagina di decisione. Il login (Google/GitHub) è solo una
// delle due strade, l'altra è "continua in locale" dove tutto resta su disco.
// Il routing verso qui è innescato dal bottone "Vai alla dashboard" di
// /onboarding una volta che il profilo è sbloccato.
export default function OnboardingCloudChoice() {
  const router = useRouter();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  return (
    <div
      className="flex flex-col items-center justify-center px-5"
      style={{
        height: "calc(100vh / var(--zoom))",
        animation: "fade-in 0.35s ease both",
      }}
    >
      <div className="max-w-md w-full flex flex-col items-center text-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-[var(--color-white)]">
          {tr("h1_pre")}
          <span className="text-[var(--color-green)]">{tr("h1_accent")}</span>
        </h1>
        <p className="text-[11px] text-[var(--color-muted)] leading-relaxed max-w-sm">
          {tr("subtitle")}
        </p>

        <div className="flex flex-col gap-2 w-full mt-4">
          <Link
            href="/?login=true"
            className="w-full px-4 py-3 rounded-lg text-[12px] font-bold tracking-wide text-center transition-opacity hover:opacity-90"
            style={{ background: "var(--color-green)", color: "#000" }}
          >
            {tr("link_account")}
          </Link>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="w-full px-4 py-3 rounded-lg text-[11px] font-semibold tracking-wide text-center cursor-pointer transition-colors hover:bg-[var(--color-row)]"
            style={{
              background: "var(--color-card)",
              color: "var(--color-muted)",
              border: "1px solid var(--color-border)",
            }}
          >
            {tr("continue_without")}
          </button>
        </div>
      </div>
    </div>
  );
}
