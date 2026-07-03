import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Capitano — Job Hunter",
    description:
      "Agente Capitano: coordina il team di agenti AI e orchestra il flusso della ricerca lavoro",
  },
  en: {
    title: "Captain — Job Hunter",
    description:
      "Captain Agent: coordinates the AI agent team and orchestrates the job search workflow",
  },
  hu: {
    title: "Kapitány — Job Hunter",
    description:
      "Kapitány ügynök: koordinálja az AI-ügynökcsapatot és vezényli az álláskeresési folyamatot",
  },
  es: {
    title: "Capitán — Job Hunter",
    description:
      "Agente Capitán: coordina el equipo de agentes de IA y orquesta el flujo de búsqueda de empleo",
  },
  de: {
    title: "Kapitän — Job Hunter",
    description:
      "Kapitän-Agent: koordiniert das KI-Agenten-Team und orchestriert den Ablauf der Jobsuche",
  },
  fr: {
    title: "Capitaine — Job Hunter",
    description:
      "Agent Capitaine : coordonne l'équipe d'agents IA et orchestre le flux de recherche d'emploi",
  },
  pt: {
    title: "Capitão — Job Hunter",
    description:
      "Agente Capitão: coordena a equipe de agentes de IA e orquestra o fluxo da busca de emprego",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function CapitanoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
