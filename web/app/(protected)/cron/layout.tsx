import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: { title: "Cron — Job Hunter", description: "Gestione job schedulati" },
  en: { title: "Cron — Job Hunter", description: "Scheduled jobs management" },
  hu: {
    title: "Cron — Job Hunter",
    description: "Ütemezett feladatok kezelése",
  },
  es: {
    title: "Cron — Job Hunter",
    description: "Gestión de tareas programadas",
  },
  de: {
    title: "Cron — Job Hunter",
    description: "Verwaltung geplanter Jobs",
  },
  fr: {
    title: "Cron — Job Hunter",
    description: "Gestion des tâches planifiées",
  },
  pt: {
    title: "Cron — Job Hunter",
    description: "Gestão de tarefas agendadas",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
