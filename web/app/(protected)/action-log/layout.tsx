import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Registro delle azioni — Job Hunter",
    description: "Che cosa ha chiesto il sito a nome tuo",
  },
  en: {
    title: "Action log — Job Hunter",
    description: "What the site asked on your behalf",
  },
  hu: {
    title: "Műveletnapló — Job Hunter",
    description: "Amit a webhely a nevedben kért",
  },
  es: {
    title: "Registro de acciones — Job Hunter",
    description: "Lo que el sitio ha pedido en tu nombre",
  },
  de: {
    title: "Aktionsprotokoll — Job Hunter",
    description: "Was die Website in deinem Namen angefordert hat",
  },
  fr: {
    title: "Journal des actions — Job Hunter",
    description: "Ce que le site a demandé en ton nom",
  },
  pt: {
    title: "Registo de ações — Job Hunter",
    description: "O que o site pediu em teu nome",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
