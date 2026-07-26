import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/request-locale";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Contatti",
    description:
      "Scrivi al team di Job Hunter Team: domande, problemi o proposte. Rispondiamo all'indirizzo che lasci.",
  },
  en: {
    title: "Contact",
    description:
      "Write to the Job Hunter Team: questions, problems or ideas. We reply to the address you leave.",
  },
  hu: {
    title: "Kapcsolat",
    description:
      "Írj a Job Hunter Team csapatának: kérdés, probléma vagy ötlet. A megadott címre válaszolunk.",
  },
  es: {
    title: "Contacto",
    description:
      "Escribe al equipo de Job Hunter Team: dudas, problemas o propuestas. Respondemos a la dirección que dejes.",
  },
  de: {
    title: "Kontakt",
    description:
      "Schreib dem Job-Hunter-Team: Fragen, Probleme oder Vorschläge. Wir antworten an die hinterlassene Adresse.",
  },
  fr: {
    title: "Contact",
    description:
      "Écris à l'équipe Job Hunter Team : questions, problèmes ou propositions. Nous répondons à l'adresse laissée.",
  },
  pt: {
    title: "Contacto",
    description:
      "Escreve à equipa do Job Hunter Team: dúvidas, problemas ou propostas. Respondemos ao endereço que deixares.",
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

export default async function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = META[await getRequestLocale()] ?? META.en;
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: m.title, path: "/contact" }]} />
      {children}
    </>
  );
}
