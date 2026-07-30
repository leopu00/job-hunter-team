import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Scorer — Job Hunter",
    description:
      "Agente Scorer: calcola priorità e score di compatibilità per le offerte",
  },
  en: {
    title: "Scorer — Job Hunter",
    description:
      "Scorer Agent: calculates priority and match score for job offers",
  },
  hu: {
    title: "Pontozó — Job Hunter",
    description:
      "Pontozó ügynök: kiszámítja az állásajánlatok prioritását és illeszkedési pontszámát",
  },
  es: {
    title: "Evaluador — Job Hunter",
    description:
      "Agente Evaluador: calcula la prioridad y el score de compatibilidad de las ofertas",
  },
  de: {
    title: "Bewerter — Job Hunter",
    description:
      "Bewerter-Agent: berechnet Priorität und Match-Score für Stellenangebote",
  },
  fr: {
    title: "Évaluateur — Job Hunter",
    description:
      "Agent Évaluateur : calcule la priorité et le score de compatibilité des offres",
  },
  pt: {
    title: "Avaliador — Job Hunter",
    description:
      "Agente Avaliador: calcula a prioridade e o score de compatibilidade das vagas",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function ScorerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
