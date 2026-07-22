// [JHT-WEB-DEMO] Etichette localizzate + icone SVG delle 4 personas demo,
// condivise da wizard /welcome, DemoBanner e DemoPickerCard (dashboard
// vuota). Un solo posto da toccare se le categorie cambiano.
import type { Locale } from "@/i18n/config";
import type { DemoPersonaKey } from "@/lib/demo/data";

export const PERSONA_LABELS: Record<Locale, Record<DemoPersonaKey, string>> = {
  it: {
    software: "Software & IT",
    marketing: "Marketing & vendite",
    finance: "Finanza & business",
    design: "Design & creatività",
  },
  en: {
    software: "Software & IT",
    marketing: "Marketing & Sales",
    finance: "Finance & Business",
    design: "Design & Creative",
  },
  es: {
    software: "Software e IT",
    marketing: "Marketing y ventas",
    finance: "Finanzas y negocio",
    design: "Diseño y creatividad",
  },
  fr: {
    software: "Logiciel & IT",
    marketing: "Marketing & ventes",
    finance: "Finance & business",
    design: "Design & créativité",
  },
  de: {
    software: "Software & IT",
    marketing: "Marketing & Vertrieb",
    finance: "Finanzen & Business",
    design: "Design & Kreation",
  },
  hu: {
    software: "Szoftver & IT",
    marketing: "Marketing & értékesítés",
    finance: "Pénzügy & üzlet",
    design: "Design & kreatív",
  },
  pt: {
    software: "Software & IT",
    marketing: "Marketing & vendas",
    finance: "Finanças & negócio",
    design: "Design & criatividade",
  },
};

export const PERSONA_ICONS: Record<DemoPersonaKey, React.ReactNode> = {
  software: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  marketing: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 11l18-7-7 18-2.5-7.5L3 11z" />
    </svg>
  ),
  finance: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  design: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="13.5" cy="6.5" r="2.5" />
      <path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h2a4 4 0 0 0 4-4A10 10 0 0 0 12 2z" />
    </svg>
  ),
};

// Attiva la demo e ricarica su /dashboard (full reload: le pagine server
// devono rifetchare col cookie appena scritto).
export async function activateDemo(persona: DemoPersonaKey): Promise<boolean> {
  try {
    const res = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona }),
    });
    if (!res.ok) return false;
    window.location.href = "/dashboard";
    return true;
  } catch {
    return false;
  }
}
