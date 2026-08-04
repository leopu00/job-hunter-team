import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Canali — Job Hunter",
    description: "Gestione canali comunicazione",
  },
  en: {
    title: "Channels — Job Hunter",
    description: "Communication channels management",
  },
  hu: {
    title: "Csatornák — Job Hunter",
    description: "Kommunikációs csatornák kezelése",
  },
  es: {
    title: "Canales — Job Hunter",
    description: "Gestión de canales de comunicación",
  },
  de: {
    title: "Kanäle — Job Hunter",
    description: "Verwaltung der Kommunikationskanäle",
  },
  fr: {
    title: "Canaux — Job Hunter",
    description: "Gestion des canaux de communication",
  },
  pt: {
    title: "Canais — Job Hunter",
    description: "Gestão de canais de comunicação",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
