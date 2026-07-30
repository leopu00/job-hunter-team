import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Analista — Job Hunter",
    description:
      "Agente Analista: legge i requisiti delle offerte e valuta la compatibilità col tuo profilo",
  },
  en: {
    title: "Analyst — Job Hunter",
    description:
      "Analyst Agent: reads job requirements and evaluates fit with your profile",
  },
  hu: {
    title: "Elemző — Job Hunter",
    description:
      "Elemző ügynök: elolvassa az állások követelményeit és értékeli az illeszkedést a profilodhoz",
  },
  es: {
    title: "Analista — Job Hunter",
    description:
      "Agente Analista: lee los requisitos de las ofertas y evalúa el encaje con tu perfil",
  },
  de: {
    title: "Analyst — Job Hunter",
    description:
      "Analyst-Agent: liest die Stellenanforderungen und bewertet die Passung zu deinem Profil",
  },
  fr: {
    title: "Analyste — Job Hunter",
    description:
      "Agent Analyste : lit les exigences des offres et évalue l'adéquation avec votre profil",
  },
  pt: {
    title: "Analista — Job Hunter",
    description:
      "Agente Analista: lê os requisitos das vagas e avalia a compatibilidade com o seu perfil",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function AnalistaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
