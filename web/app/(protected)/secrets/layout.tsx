import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Segreti — Job Hunter",
    description: "Gestione chiavi API e segreti",
  },
  en: {
    title: "Secrets — Job Hunter",
    description: "API keys and secrets management",
  },
  hu: {
    title: "Titkok — Job Hunter",
    description: "API-kulcsok és titkok kezelése",
  },
  es: {
    title: "Secretos — Job Hunter",
    description: "Gestión de claves API y secretos",
  },
  de: {
    title: "Geheimnisse — Job Hunter",
    description: "Verwaltung von API-Schlüsseln und Geheimnissen",
  },
  fr: {
    title: "Secrets — Job Hunter",
    description: "Gestion des clés API et des secrets",
  },
  pt: {
    title: "Segredos — Job Hunter",
    description: "Gestão de chaves de API e segredos",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
