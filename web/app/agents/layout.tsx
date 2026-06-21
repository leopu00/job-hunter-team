import type { Metadata } from "next";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Il Team",
  description:
    "I ruoli del team di agenti AI di Job Hunter Team: Capitano, Scout, Analista, Scorer, Scrittore, Critico, Sentinella, Dottore, Mentor e Assistente.",
  openGraph: {
    title: "Il Team | Job Hunter Team",
    description:
      "Una squadra di agenti AI specializzati: chi cerca, chi verifica, chi valuta, chi scrive e chi critica.",
  },
};

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Team", path: "/agents" }]} />
      {children}
    </>
  );
}
