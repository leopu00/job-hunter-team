import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: { title: "Esportazione — Job Hunter", description: "Esportazione dati" },
  en: { title: "Export — Job Hunter", description: "Data export" },
  hu: { title: "Exportálás — Job Hunter", description: "Adatexportálás" },
  es: {
    title: "Exportación — Job Hunter",
    description: "Exportación de datos",
  },
  de: { title: "Export — Job Hunter", description: "Datenexport" },
  fr: {
    title: "Exportation — Job Hunter",
    description: "Exportation de données",
  },
  pt: { title: "Exportação — Job Hunter", description: "Exportação de dados" },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
