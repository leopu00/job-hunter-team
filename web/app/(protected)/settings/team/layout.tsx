import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Orari e modelli del team — Job Hunter",
    description:
      "Orari di lavoro e modello di ogni ruolo, applicati dal tuo computer",
  },
  en: {
    title: "Team hours and models — Job Hunter",
    description:
      "Working hours and each role's model, applied by your computer",
  },
  hu: {
    title: "A csapat munkaideje és modelljei — Job Hunter",
    description:
      "Munkaidő és az egyes szerepek modellje, a számítógéped alkalmazza",
  },
  es: {
    title: "Horarios y modelos del equipo — Job Hunter",
    description:
      "Horario de trabajo y modelo de cada rol, aplicados por tu ordenador",
  },
  de: {
    title: "Arbeitszeiten und Modelle des Teams — Job Hunter",
    description:
      "Arbeitszeiten und das Modell jeder Rolle, von deinem Computer übernommen",
  },
  fr: {
    title: "Horaires et modèles de l'équipe — Job Hunter",
    description:
      "Horaires de travail et modèle de chaque rôle, appliqués par ton ordinateur",
  },
  pt: {
    title: "Horários e modelos da equipe — Job Hunter",
    description:
      "Horário de trabalho e modelo de cada função, aplicados pelo teu computador",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
