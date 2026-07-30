import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Integrazioni — Job Hunter",
    description: "Gestione integrazioni esterne",
  },
  en: {
    title: "Integrations — Job Hunter",
    description: "External integrations management",
  },
  hu: {
    title: "Integrációk — Job Hunter",
    description: "Külső integrációk kezelése",
  },
  es: {
    title: "Integraciones — Job Hunter",
    description: "Gestión de integraciones externas",
  },
  de: {
    title: "Integrationen — Job Hunter",
    description: "Verwaltung externer Integrationen",
  },
  fr: {
    title: "Intégrations — Job Hunter",
    description: "Gestion des intégrations externes",
  },
  pt: {
    title: "Integrações — Job Hunter",
    description: "Gestão de integrações externas",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
