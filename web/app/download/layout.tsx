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
    title: "Installa",
    description:
      "Scarica l'app desktop di Job Hunter Team oppure installalo dal terminale con la CLI. Il tuo team di agenti AI gira sul tuo computer — open source, locale, privato.",
    jsonLdDescription:
      "Un team di agenti AI che automatizza la ricerca di lavoro. Open source, locale, privato.",
  },
  en: {
    title: "Install",
    description:
      "Download the Job Hunter Team desktop app, or install it from the terminal with the CLI. Your AI agent team runs on your own computer — open source, local, private.",
    jsonLdDescription:
      "A team of AI agents that automates the job search. Open source, local, private.",
  },
  es: {
    title: "Instalar",
    description:
      "Descarga la app de escritorio de Job Hunter Team o instálalo desde la terminal con la CLI. Tu equipo de agentes de IA se ejecuta en tu propio ordenador — open source, local, privado.",
    jsonLdDescription:
      "Un equipo de agentes de IA que automatiza la búsqueda de empleo. Open source, local, privado.",
  },
  fr: {
    title: "Installer",
    description:
      "Téléchargez l'app de bureau Job Hunter Team ou installez-la depuis le terminal avec la CLI. Votre équipe d'agents IA s'exécute sur votre propre ordinateur — open source, locale, privée.",
    jsonLdDescription:
      "Une équipe d'agents IA qui automatise la recherche d'emploi. Open source, locale, privée.",
  },
  de: {
    title: "Installieren",
    description:
      "Lade die Job Hunter Team Desktop-App herunter oder installiere sie über das Terminal mit der CLI. Dein KI-Agententeam läuft auf deinem eigenen Computer — Open Source, lokal, privat.",
    jsonLdDescription:
      "Ein Team von KI-Agenten, das die Jobsuche automatisiert. Open source, lokal, privat.",
  },
  hu: {
    title: "Telepítés",
    description:
      "Töltsd le a Job Hunter Team asztali appját, vagy telepítsd terminálból a CLI-val. Az MI-ügynökökből álló csapatod a saját számítógépeden fut — open source, helyi, privát.",
    jsonLdDescription:
      "MI-ügynökökből álló csapat, amely automatizálja az álláskeresést. Open source, helyi, privát.",
  },
  pt: {
    title: "Instalar",
    description:
      "Descarrega a app de ambiente de trabalho Job Hunter Team ou instala-a a partir do terminal com a CLI. A tua equipa de agentes de IA corre no teu próprio computador — open source, local, privada.",
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
  // La pagina lascia scegliere piattaforma e modalità; i pulsanti risolvono gli
  // asset della release più recente. `installUrl` resta quindi la pagina
  // d'installazione, non un singolo file dipendente dalla piattaforma.
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Job Hunter Team",
    applicationCategory: "BusinessApplication",
    operatingSystem: "macOS, Windows, Linux",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    installUrl: `${SITE_URL}/download`,
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
