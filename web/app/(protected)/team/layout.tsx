import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Team — Job Hunter",
    description:
      "Gestisci il team di agenti AI: avvia, monitora e coordina Scout, Analista, Scorer, Scrittore e gli altri",
  },
  en: {
    title: "Team — Job Hunter",
    description:
      "Manage your AI agent team: start, monitor and coordinate Scout, Analyst, Scorer, Writer and others",
  },
  hu: {
    title: "Csapat — Job Hunter",
    description:
      "AI-ügynökcsapat kezelése: a Felderítő, az Elemző, a Pontozó, az Író és a többiek indítása, figyelése és koordinálása",
  },
  es: {
    title: "Equipo — Job Hunter",
    description:
      "Gestiona tu equipo de agentes de IA: inicia, supervisa y coordina al Explorador, el Analista, el Evaluador, el Redactor y otros",
  },
  de: {
    title: "Team — Job Hunter",
    description:
      "Verwalte dein KI-Agenten-Team: starte, überwache und koordiniere Späher, Analyst, Bewerter, Verfasser und weitere",
  },
  fr: {
    title: "Équipe — Job Hunter",
    description:
      "Gérez votre équipe d'agents IA : démarrez, surveillez et coordonnez l'Éclaireur, l'Analyste, l'Évaluateur, le Rédacteur et les autres",
  },
  pt: {
    title: "Equipe — Job Hunter",
    description:
      "Gerencie sua equipe de agentes de IA: inicie, monitore e coordene o Explorador, o Analista, o Avaliador, o Redator e outros",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
