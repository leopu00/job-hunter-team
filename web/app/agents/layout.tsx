import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/request-locale";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";

const META: Record<
  string,
  { title: string; description: string; ogDescription: string; crumb: string }
> = {
  it: {
    title: "Il Team",
    description:
      "I ruoli del team di agenti AI di Job Hunter Team: Coordinatore, Scout, Analista, Scorer, Scrittore, Critico, Sentinella, Dottore, Mentor e Assistente.",
    ogDescription:
      "Una squadra di agenti AI specializzati: chi cerca, chi verifica, chi valuta, chi scrive e chi critica.",
    crumb: "Team",
  },
  en: {
    title: "The Team",
    description:
      "The roles of Job Hunter Team's AI agent team: Coordinator, Scout, Analyst, Scorer, Writer, Critic, Sentinel, Doctor, Mentor and Assistant.",
    ogDescription:
      "A team of specialized AI agents: who searches, who verifies, who rates, who writes and who critiques.",
    crumb: "Team",
  },
  es: {
    title: "El Equipo",
    description:
      "Los roles del equipo de agentes de IA de Job Hunter Team: Coordinador, Scout, Analista, Scorer, Redactor, Crítico, Centinela, Doctor, Mentor y Asistente.",
    ogDescription:
      "Un equipo de agentes de IA especializados: quién busca, quién verifica, quién valora, quién escribe y quién critica.",
    crumb: "Equipo",
  },
  fr: {
    title: "L'Équipe",
    description:
      "Les rôles de l'équipe d'agents IA de Job Hunter Team : Coordinateur, Scout, Analyste, Évaluateur, Rédacteur, Critique, Sentinelle, Docteur, Mentor et Assistant.",
    ogDescription:
      "Une équipe d'agents IA spécialisés : qui cherche, qui vérifie, qui évalue, qui rédige et qui critique.",
    crumb: "Équipe",
  },
  de: {
    title: "Das Team",
    description:
      "Die Rollen des KI-Agententeams von Job Hunter Team: Koordinator, Scout, Analyst, Bewerter, Verfasser, Kritiker, Wächter, Doktor, Mentor und Assistent.",
    ogDescription:
      "Ein Team spezialisierter KI-Agenten: wer sucht, wer prüft, wer bewertet, wer schreibt und wer kritisiert.",
    crumb: "Team",
  },
  pt: {
    title: "A Equipe",
    description:
      "Os papéis da equipe de agentes de IA do Job Hunter Team: Coordenador, Scout, Analista, Scorer, Redator, Crítico, Sentinela, Doutor, Mentor e Assistente.",
    ogDescription:
      "Uma equipe de agentes de IA especializados: quem procura, quem verifica, quem avalia, quem escreve e quem critica.",
    crumb: "Equipe",
  },
  hu: {
    title: "A Csapat",
    description:
      "A Job Hunter Team MI-ügynökcsapatának szerepei: Koordinátor, Felderítő, Elemző, Pontozó, Író, Kritikus, Őrszem, Doktor, Mentor és Asszisztens.",
    ogDescription:
      "Szakosodott MI-ügynökök csapata: aki keres, aki ellenőriz, aki értékel, aki ír és aki kritizál.",
    crumb: "Csapat",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getRequestLocale()] ?? META.en;
  return {
    title: m.title,
    description: m.description,
    openGraph: {
      title: `${m.title} | Job Hunter Team`,
      description: m.ogDescription,
    },
  };
}

export default async function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = META[await getRequestLocale()] ?? META.en;
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: m.crumb, path: "/agents" }]} />
      {children}
    </>
  );
}
