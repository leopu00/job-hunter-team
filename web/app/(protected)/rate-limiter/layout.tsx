import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Rate Limiter — Job Hunter",
    description: "Controllo limiti richieste",
  },
  en: {
    title: "Rate Limiter — Job Hunter",
    description: "Request rate limits control",
  },
  hu: {
    title: "Rate Limiter — Job Hunter",
    description: "Kérési limitek kezelése",
  },
  es: {
    title: "Rate Limiter — Job Hunter",
    description: "Control de límites de solicitudes",
  },
  de: {
    title: "Rate Limiter — Job Hunter",
    description: "Steuerung der Anfragelimits",
  },
  fr: {
    title: "Rate Limiter — Job Hunter",
    description: "Contrôle des limites de requêtes",
  },
  pt: {
    title: "Rate Limiter — Job Hunter",
    description: "Controle de limites de requisições",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
