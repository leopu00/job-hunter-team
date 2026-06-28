import type { Metadata } from "next";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";
import { type ServerLocale } from "@/lib/server-locale";
import { getRequestLocale } from "@/lib/request-locale";

const META: Record<
  ServerLocale,
  {
    title: string;
    description: string;
    ogTitle: string;
    ogDesc: string;
    crumb: string;
  }
> = {
  it: {
    title: "Prezzi",
    description:
      "Job Hunter Team è open source: la piattaforma è gratuita, paghi solo il provider AI che scegli (Kimi, Codex o Claude). Con i modelli locali, solo l'elettricità.",
    ogTitle: "Prezzi | Job Hunter Team",
    ogDesc:
      "Piattaforma open source e gratuita. Paghi solo il provider AI: da circa €40 al mese.",
    crumb: "Prezzi",
  },
  en: {
    title: "Pricing",
    description:
      "Job Hunter Team is open source: the platform is free, you only pay for the AI provider you choose (Kimi, Codex or Claude). With local models, only the electricity.",
    ogTitle: "Pricing | Job Hunter Team",
    ogDesc:
      "Open source and free platform. You only pay for the AI provider: from about €40 a month.",
    crumb: "Pricing",
  },
  es: {
    title: "Precios",
    description:
      "Job Hunter Team es open source: la plataforma es gratuita, solo pagas el proveedor de IA que elijas (Kimi, Codex o Claude). Con los modelos locales, solo la electricidad.",
    ogTitle: "Precios | Job Hunter Team",
    ogDesc:
      "Plataforma open source y gratuita. Solo pagas el proveedor de IA: desde unos €40 al mes.",
    crumb: "Precios",
  },
  fr: {
    title: "Tarifs",
    description:
      "Job Hunter Team est open source : la plateforme est gratuite, vous ne payez que le fournisseur d'IA que vous choisissez (Kimi, Codex ou Claude). Avec les modèles locaux, seulement l'électricité.",
    ogTitle: "Tarifs | Job Hunter Team",
    ogDesc:
      "Plateforme open source et gratuite. Vous ne payez que le fournisseur d'IA : à partir d'environ €40 par mois.",
    crumb: "Tarifs",
  },
  de: {
    title: "Preise",
    description:
      "Job Hunter Team ist Open Source: Die Plattform ist kostenlos, du zahlst nur den KI-Anbieter, den du wählst (Kimi, Codex oder Claude). Mit lokalen Modellen nur den Strom.",
    ogTitle: "Preise | Job Hunter Team",
    ogDesc:
      "Open-Source- und kostenlose Plattform. Du zahlst nur den KI-Anbieter: ab etwa €40 im Monat.",
    crumb: "Preise",
  },
  hu: {
    title: "Árak",
    description:
      "A Job Hunter Team nyílt forráskódú: a platform ingyenes, csak az általad választott AI-szolgáltatóért fizetsz (Kimi, Codex vagy Claude). Helyi modellekkel csak az áramért.",
    ogTitle: "Árak | Job Hunter Team",
    ogDesc:
      "Nyílt forráskódú és ingyenes platform. Csak az AI-szolgáltatóért fizetsz: havi körülbelül €40-tól.",
    crumb: "Árak",
  },
  pt: {
    title: "Preços",
    description:
      "O Job Hunter Team é open source: a plataforma é gratuita, só pagas o fornecedor de IA que escolheres (Kimi, Codex ou Claude). Com os modelos locais, só a eletricidade.",
    ogTitle: "Preços | Job Hunter Team",
    ogDesc:
      "Plataforma open source e gratuita. Só pagas o fornecedor de IA: a partir de cerca de €40 por mês.",
    crumb: "Preços",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getRequestLocale()];
  return {
    title: m.title,
    description: m.description,
    openGraph: { title: m.ogTitle, description: m.ogDesc },
  };
}

export default async function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = META[await getRequestLocale()];
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: m.crumb, path: "/pricing" }]} />
      {children}
    </>
  );
}
