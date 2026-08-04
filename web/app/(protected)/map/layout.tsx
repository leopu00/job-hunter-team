import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Map — Job Hunter",
    description: "Mappa delle posizioni: distribuzione per città, score e tipo",
  },
  en: {
    title: "Map — Job Hunter",
    description: "Positions map: distribution by city, score and type",
  },
  hu: {
    title: "Map — Job Hunter",
    description: "Pozíciók térképe: megoszlás város, score és típus szerint",
  },
  es: {
    title: "Mapa — Job Hunter",
    description: "Mapa de posiciones: distribución por ciudad, score y tipo",
  },
  de: {
    title: "Karte — Job Hunter",
    description: "Stellenkarte: Verteilung nach Stadt, Score und Typ",
  },
  fr: {
    title: "Carte — Job Hunter",
    description: "Carte des postes : répartition par ville, score et type",
  },
  pt: {
    title: "Mapa — Job Hunter",
    description: "Mapa de vagas: distribuição por cidade, score e tipo",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
