import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Posizioni — Job Hunter",
    description: "Esplora e gestisci le posizioni trovate dall'agente Scout",
  },
  en: {
    title: "Positions — Job Hunter",
    description: "Browse and manage job positions found by the Scout agent",
  },
  hu: {
    title: "Állások — Job Hunter",
    description:
      "A Felderítő ügynök által talált állások böngészése és kezelése",
  },
  es: {
    title: "Posiciones — Job Hunter",
    description:
      "Explora y gestiona las posiciones encontradas por el agente Explorador",
  },
  de: {
    title: "Stellen — Job Hunter",
    description:
      "Vom Späher-Agenten gefundene Stellen durchsuchen und verwalten",
  },
  fr: {
    title: "Postes — Job Hunter",
    description: "Parcourez et gérez les postes trouvés par l'agent Éclaireur",
  },
  pt: {
    title: "Vagas — Job Hunter",
    description:
      "Explore e gerencie as vagas encontradas pelo agente Explorador",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function PositionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
