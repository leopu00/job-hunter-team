import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";
import { getNonce } from "@/lib/csp";
import { getRequestLocale } from "@/lib/request-locale";

const META: Record<
  Locale,
  { title: string; description: string; jsonLdDescription: string }
> = {
  it: {
    title: "Download",
    description:
      "Scarica Job Hunter Team per macOS, Linux o Windows. Avvia il team di agenti AI sul tuo computer in pochi minuti.",
    jsonLdDescription:
      "Un team di agenti AI che automatizza la ricerca di lavoro. Open source, locale, privato.",
  },
  en: {
    title: "Download",
    description:
      "Download Job Hunter Team for macOS, Linux or Windows. Launch your AI agent team on your computer in minutes.",
    jsonLdDescription:
      "A team of AI agents that automates the job search. Open source, local, private.",
  },
  es: {
    title: "Descargar",
    description:
      "Descarga Job Hunter Team para macOS, Linux o Windows. Pon en marcha tu equipo de agentes de IA en tu ordenador en pocos minutos.",
    jsonLdDescription:
      "Un equipo de agentes de IA que automatiza la búsqueda de empleo. Open source, local, privado.",
  },
  fr: {
    title: "Télécharger",
    description:
      "Téléchargez Job Hunter Team pour macOS, Linux ou Windows. Lancez votre équipe d'agents IA sur votre ordinateur en quelques minutes.",
    jsonLdDescription:
      "Une équipe d'agents IA qui automatise la recherche d'emploi. Open source, locale, privée.",
  },
  de: {
    title: "Herunterladen",
    description:
      "Lade Job Hunter Team für macOS, Linux oder Windows herunter. Starte dein KI-Agententeam in wenigen Minuten auf deinem Computer.",
    jsonLdDescription:
      "Ein Team von KI-Agenten, das die Jobsuche automatisiert. Open source, lokal, privat.",
  },
  hu: {
    title: "Letöltés",
    description:
      "Töltsd le a Job Hunter Teamet macOS, Linux vagy Windows rendszerre. Indítsd el az MI-ügynökökből álló csapatodat a számítógépeden pár perc alatt.",
    jsonLdDescription:
      "MI-ügynökökből álló csapat, amely automatizálja az álláskeresést. Open source, helyi, privát.",
  },
  pt: {
    title: "Descarregar",
    description:
      "Descarregue o Job Hunter Team para macOS, Linux ou Windows. Coloque a sua equipa de agentes de IA a funcionar no seu computador em poucos minutos.",
    jsonLdDescription:
      "Uma equipa de agentes de IA que automatiza a procura de emprego. Open source, local, privada.",
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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobhunterteam.ai";

async function DownloadJsonLd() {
  const [nonce, locale] = await Promise.all([getNonce(), getRequestLocale()]);
  const m = META[locale] ?? META.en;
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Job Hunter Team",
    applicationCategory: "BusinessApplication",
    operatingSystem: "macOS, Linux, Windows",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    downloadUrl: `${SITE_URL}/download`,
    softwareVersion: "0.1.0",
    description: m.jsonLdDescription,
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
  };
  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function DownloadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Download", path: "/download" }]} />
      <DownloadJsonLd />
      {children}
    </>
  );
}
