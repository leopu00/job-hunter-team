import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: { title: "Backup — Job Hunter", description: "Gestione backup dati" },
  en: { title: "Backup — Job Hunter", description: "Data backup management" },
  hu: {
    title: "Backup — Job Hunter",
    description: "Adatmentések kezelése",
  },
  es: {
    title: "Backup — Job Hunter",
    description: "Gestión de copias de seguridad",
  },
  de: {
    title: "Backup — Job Hunter",
    description: "Verwaltung der Datensicherungen",
  },
  fr: {
    title: "Backup — Job Hunter",
    description: "Gestion des sauvegardes de données",
  },
  pt: {
    title: "Backup — Job Hunter",
    description: "Gestão de backups de dados",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
