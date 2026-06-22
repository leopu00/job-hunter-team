import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: { title: "Onboarding — Job Hunter", description: "Configurazione iniziale" },
  en: { title: "Onboarding — Job Hunter", description: "Initial setup" },
  hu: { title: "Bevezetés — Job Hunter", description: "Kezdeti beállítás" },
  es: { title: "Onboarding — Job Hunter", description: "Configuración inicial" },
  de: { title: "Onboarding — Job Hunter", description: "Erste Einrichtung" },
  fr: { title: "Onboarding — Job Hunter", description: "Configuration initiale" },
  pt: { title: "Onboarding — Job Hunter", description: "Configuração inicial" },
};

export function generateMetadata(): Metadata {
  const locale = getServerLocale();
  return META[locale] ?? META.it;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
