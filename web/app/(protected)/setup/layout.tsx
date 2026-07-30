import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const TITLES: Record<string, string> = {
  it: "Setup",
  en: "Setup",
  hu: "Beállítás",
  es: "Configuración",
  de: "Einrichtung",
  fr: "Configuration",
  pt: "Configuração",
};

const DESCRIPTIONS: Record<string, string> = {
  it: "Configurazione iniziale di Job Hunter Team: provider AI, API key, workspace e health check.",
  en: "Initial setup of Job Hunter Team: AI provider, API key, workspace and health check.",
  hu: "A Job Hunter Team kezdeti beállítása: AI-szolgáltató, API key, munkaterület és health check.",
  es: "Configuración inicial de Job Hunter Team: proveedor de IA, API key, workspace y health check.",
  de: "Erstkonfiguration von Job Hunter Team: KI-Anbieter, API key, Workspace und Health Check.",
  fr: "Configuration initiale de Job Hunter Team : fournisseur IA, API key, workspace et health check.",
  pt: "Configuração inicial do Job Hunter Team: provedor de IA, API key, workspace e health check.",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return {
    title: TITLES[locale] ?? TITLES.en,
    description: DESCRIPTIONS[locale] ?? DESCRIPTIONS.en,
    robots: { index: false, follow: false },
  };
}

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
