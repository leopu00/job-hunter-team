import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Dashboard — Job Hunter",
    description:
      "Panoramica dei progressi della ricerca lavoro e delle attività degli agenti",
  },
  en: {
    title: "Dashboard — Job Hunter",
    description: "Overview of your job search progress and agent activities",
  },
  hu: {
    title: "Irányítópult — Job Hunter",
    description:
      "Áttekintés az álláskeresés előrehaladásáról és az ügynökök tevékenységéről",
  },
  es: {
    title: "Panel — Job Hunter",
    description:
      "Resumen del progreso de tu búsqueda de empleo y de la actividad de los agentes",
  },
  de: {
    title: "Dashboard — Job Hunter",
    description:
      "Überblick über den Fortschritt der Jobsuche und die Aktivitäten der Agenten",
  },
  fr: {
    title: "Tableau de bord — Job Hunter",
    description:
      "Aperçu de l'avancement de votre recherche d'emploi et de l'activité des agents",
  },
  pt: {
    title: "Painel — Job Hunter",
    description:
      "Visão geral do progresso da busca de emprego e das atividades dos agentes",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
