import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/request-locale";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Termini di Servizio",
    description: "Termini e condizioni di utilizzo di Job Hunter Team.",
  },
  en: {
    title: "Terms of Service",
    description: "Terms and conditions of use of Job Hunter Team.",
  },
  hu: {
    title: "Szolgáltatási feltételek",
    description: "A Job Hunter Team használati feltételei.",
  },
  es: {
    title: "Términos del Servicio",
    description: "Términos y condiciones de uso de Job Hunter Team.",
  },
  de: {
    title: "Nutzungsbedingungen",
    description: "Allgemeine Geschäftsbedingungen von Job Hunter Team.",
  },
  fr: {
    title: "Conditions d'Utilisation",
    description: "Conditions générales d'utilisation de Job Hunter Team.",
  },
  pt: {
    title: "Termos de Serviço",
    description: "Termos e condições de utilização do Job Hunter Team.",
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

export default async function TermsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = META[await getRequestLocale()] ?? META.en;
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: m.title, path: "/terms" }]} />
      {children}
    </>
  );
}
