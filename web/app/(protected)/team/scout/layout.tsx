import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Scout — Job Hunter",
    description:
      "Agente Scout: cerca nuove opportunità sui canali di offerte di lavoro",
  },
  en: {
    title: "Scout — Job Hunter",
    description: "Scout Agent: searches for new opportunities on job channels",
  },
  hu: {
    title: "Felderítő — Job Hunter",
    description: "Felderítő ügynök: új lehetőségeket keres az álláscsatornákon",
  },
  es: {
    title: "Explorador — Job Hunter",
    description:
      "Agente Explorador: busca nuevas oportunidades en los canales de empleo",
  },
  de: {
    title: "Späher — Job Hunter",
    description: "Späher-Agent: sucht neue Möglichkeiten in den Job-Kanälen",
  },
  fr: {
    title: "Éclaireur — Job Hunter",
    description:
      "Agent Éclaireur : recherche de nouvelles opportunités sur les canaux d'emploi",
  },
  pt: {
    title: "Explorador — Job Hunter",
    description:
      "Agente Explorador: busca novas oportunidades nos canais de vagas",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function ScoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
