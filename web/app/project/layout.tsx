import type { Metadata } from "next";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";
import { getNonce } from "@/lib/csp";
import { getRequestLocale } from "@/lib/request-locale";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobhunterteam.ai";

const META: Record<
  string,
  { title: string; description: string; jsonName: string; crumb: string }
> = {
  it: {
    title: "Progetto",
    description:
      "Panoramica pubblica del progetto Job Hunter Team: obiettivo, repository, stack e architettura open source.",
    jsonName: "Progetto - Job Hunter Team",
    crumb: "Progetto",
  },
  en: {
    title: "Project",
    description:
      "Public overview of the Job Hunter Team project: goal, repository, stack and open-source architecture.",
    jsonName: "Project - Job Hunter Team",
    crumb: "Project",
  },
  es: {
    title: "Proyecto",
    description:
      "Panorámica pública del proyecto Job Hunter Team: objetivo, repositorio, stack y arquitectura open source.",
    jsonName: "Proyecto - Job Hunter Team",
    crumb: "Proyecto",
  },
  fr: {
    title: "Projet",
    description:
      "Aperçu public du projet Job Hunter Team : objectif, dépôt, stack et architecture open source.",
    jsonName: "Projet - Job Hunter Team",
    crumb: "Projet",
  },
  de: {
    title: "Projekt",
    description:
      "Öffentlicher Überblick über das Projekt Job Hunter Team: Ziel, Repository, Stack und Open-Source-Architektur.",
    jsonName: "Projekt - Job Hunter Team",
    crumb: "Projekt",
  },
  pt: {
    title: "Projeto",
    description:
      "Visão geral pública do projeto Job Hunter Team: objetivo, repositório, stack e arquitetura open source.",
    jsonName: "Projeto - Job Hunter Team",
    crumb: "Projeto",
  },
  hu: {
    title: "Projekt",
    description:
      "A Job Hunter Team projekt nyilvános áttekintése: cél, tároló, stack és nyílt forráskódú architektúra.",
    jsonName: "Projekt - Job Hunter Team",
    crumb: "Projekt",
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

async function ProjectJsonLd() {
  const nonce = await getNonce();
  const m = META[await getRequestLocale()] ?? META.en;
  const data = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: m.jsonName,
    description: m.description,
    url: `${SITE_URL}/project`,
    isPartOf: { "@type": "WebSite", name: "Job Hunter Team", url: SITE_URL },
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

export default async function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = META[await getRequestLocale()] ?? META.en;
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: m.crumb, path: "/project" }]} />
      <ProjectJsonLd />
      {children}
    </>
  );
}
