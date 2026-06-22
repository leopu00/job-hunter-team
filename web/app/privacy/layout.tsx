import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/request-locale";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Privacy Policy",
    description:
      "Privacy policy di Job Hunter Team: dati locali, nessun tracciamento, chiavi API sicure, open source.",
  },
  en: {
    title: "Privacy Policy",
    description:
      "Job Hunter Team privacy policy: local data, no tracking, secure API keys, open source.",
  },
  hu: {
    title: "Adatvédelmi irányelvek",
    description:
      "A Job Hunter Team adatvédelmi irányelvei: helyi adatok, nyomon követés nélkül, biztonságos API kulcsok, nyílt forráskód.",
  },
  es: {
    title: "Política de Privacidad",
    description:
      "Política de privacidad de Job Hunter Team: datos locales, sin rastreo, claves API seguras, código abierto.",
  },
  de: {
    title: "Datenschutzerklärung",
    description:
      "Datenschutzerklärung von Job Hunter Team: lokale Daten, kein Tracking, sichere API-Schlüssel, Open Source.",
  },
  fr: {
    title: "Politique de Confidentialité",
    description:
      "Politique de confidentialité de Job Hunter Team : données locales, aucun suivi, clés API sécurisées, open source.",
  },
  pt: {
    title: "Política de Privacidade",
    description:
      "Política de privacidade do Job Hunter Team: dados locais, sem rastreamento, chaves API seguras, código aberto.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getRequestLocale()] ?? META.en;
  return {
    title: m.title,
    description: m.description,
    openGraph: {
      title: `${m.title} | Job Hunter Team`,
      description: m.description,
    },
    twitter: {
      card: "summary",
      title: `${m.title} | Job Hunter Team`,
      description: m.description,
    },
  };
}

export default async function PrivacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = META[await getRequestLocale()] ?? META.en;
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: m.title, path: "/privacy" }]} />
      {children}
    </>
  );
}
