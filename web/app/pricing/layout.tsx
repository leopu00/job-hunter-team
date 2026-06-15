import type { Metadata } from "next";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Prezzi",
  description:
    "Job Hunter Team è open source: la piattaforma è gratuita, paghi solo il provider AI che scegli (Kimi, Codex o Claude). Con i modelli locali, solo l'elettricità.",
  openGraph: {
    title: "Prezzi | Job Hunter Team",
    description:
      "Piattaforma open source e gratuita. Paghi solo il provider AI: da circa €40 al mese.",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Prezzi", path: "/pricing" }]} />
      {children}
    </>
  );
}
