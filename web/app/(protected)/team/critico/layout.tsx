import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Critico — Job Hunter",
    description:
      "Agente Critico: revisiona i materiali e segnala cosa va corretto",
  },
  en: {
    title: "Critic — Job Hunter",
    description:
      "Critic Agent: reviews materials and flags what needs to be corrected",
  },
  hu: {
    title: "Kritikus — Job Hunter",
    description:
      "Kritikus ügynök: átnézi az anyagokat és jelzi, mit kell javítani",
  },
  es: {
    title: "Crítico — Job Hunter",
    description:
      "Agente Crítico: revisa los materiales y señala lo que hay que corregir",
  },
  de: {
    title: "Kritiker — Job Hunter",
    description:
      "Kritiker-Agent: prüft die Unterlagen und markiert, was korrigiert werden muss",
  },
  fr: {
    title: "Critique — Job Hunter",
    description:
      "Agent Critique : relit les documents et signale ce qui doit être corrigé",
  },
  pt: {
    title: "Crítico — Job Hunter",
    description:
      "Agente Crítico: revisa os materiais e sinaliza o que precisa ser corrigido",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function CriticoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
