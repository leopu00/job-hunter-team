import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Scrittore — Job Hunter",
    description:
      "Agente Scrittore: prepara CV e lettere di presentazione su misura per ogni posizione",
  },
  en: {
    title: "Writer — Job Hunter",
    description:
      "Writer Agent: prepares tailored CVs and cover letters for each job position",
  },
  hu: {
    title: "Író — Job Hunter",
    description:
      "Író ügynök: testreszabott önéletrajzokat és motivációs leveleket készít minden pozícióhoz",
  },
  es: {
    title: "Redactor — Job Hunter",
    description:
      "Agente Redactor: prepara CV y cartas de presentación a medida para cada posición",
  },
  de: {
    title: "Verfasser — Job Hunter",
    description:
      "Verfasser-Agent: erstellt maßgeschneiderte Lebensläufe und Anschreiben für jede Stelle",
  },
  fr: {
    title: "Rédacteur — Job Hunter",
    description:
      "Agent Rédacteur : prépare des CV et lettres de motivation sur mesure pour chaque poste",
  },
  pt: {
    title: "Redator — Job Hunter",
    description:
      "Agente Redator: prepara CVs e cartas de apresentação sob medida para cada vaga",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function ScrittoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
