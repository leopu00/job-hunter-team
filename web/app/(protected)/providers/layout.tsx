import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Provider — Job Hunter",
    description: "Provider AI configurati",
  },
  en: {
    title: "Providers — Job Hunter",
    description: "Configured AI providers",
  },
  hu: {
    title: "Szolgáltatók — Job Hunter",
    description: "Konfigurált AI szolgáltatók",
  },
  es: {
    title: "Proveedores — Job Hunter",
    description: "Proveedores de IA configurados",
  },
  de: {
    title: "Anbieter — Job Hunter",
    description: "Konfigurierte KI-Anbieter",
  },
  fr: {
    title: "Fournisseurs — Job Hunter",
    description: "Fournisseurs IA configurés",
  },
  pt: {
    title: "Provedores — Job Hunter",
    description: "Provedores de IA configurados",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function ProvidersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
