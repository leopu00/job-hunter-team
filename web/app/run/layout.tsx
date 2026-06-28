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
    title: "Come si avvia",
    description:
      "Fai girare il team sul tuo PC con Docker, su un computer dedicato o su una VPS sempre accesa. Gestisci tutto dall'app desktop. Requisiti e sistemi supportati.",
    ogTitle: "Come si avvia | Job Hunter Team",
    ogDesc:
      "PC, computer dedicato o VPS: scegli dove far girare la squadra e gestisci tutto dall'app desktop.",
    crumb: "Come si avvia",
  },
  en: {
    title: "How to run it",
    description:
      "Run the team on your PC with Docker, on a dedicated computer or on an always-on VPS. Manage everything from the desktop app. Requirements and supported systems.",
    ogTitle: "How to run it | Job Hunter Team",
    ogDesc:
      "PC, dedicated computer or VPS: choose where the team runs and manage everything from the desktop app.",
    crumb: "How to run it",
  },
  es: {
    title: "Cómo se inicia",
    description:
      "Haz funcionar el equipo en tu PC con Docker, en un ordenador dedicado o en una VPS siempre encendida. Gestiona todo desde la app de escritorio. Requisitos y sistemas compatibles.",
    ogTitle: "Cómo se inicia | Job Hunter Team",
    ogDesc:
      "PC, ordenador dedicado o VPS: elige dónde hacer funcionar el equipo y gestiona todo desde la app de escritorio.",
    crumb: "Cómo se inicia",
  },
  fr: {
    title: "Comment le lancer",
    description:
      "Faites tourner l'équipe sur votre PC avec Docker, sur un ordinateur dédié ou sur un VPS toujours allumé. Gérez tout depuis l'app de bureau. Configuration requise et systèmes pris en charge.",
    ogTitle: "Comment le lancer | Job Hunter Team",
    ogDesc:
      "PC, ordinateur dédié ou VPS : choisissez où faire tourner l'équipe et gérez tout depuis l'app de bureau.",
    crumb: "Comment le lancer",
  },
  de: {
    title: "So wird es gestartet",
    description:
      "Lass das Team auf deinem PC mit Docker, auf einem dedizierten Computer oder auf einem stets eingeschalteten VPS laufen. Verwalte alles über die Desktop-App. Anforderungen und unterstützte Systeme.",
    ogTitle: "So wird es gestartet | Job Hunter Team",
    ogDesc:
      "PC, dedizierter Computer oder VPS: Wähle, wo das Team läuft, und verwalte alles über die Desktop-App.",
    crumb: "So wird es gestartet",
  },
  hu: {
    title: "Hogyan indítható",
    description:
      "Futtasd a csapatot a saját géped Dockerrel, egy dedikált számítógépen vagy egy mindig bekapcsolt VPS-en. Mindent az asztali appból kezelsz. Követelmények és támogatott rendszerek.",
    ogTitle: "Hogyan indítható | Job Hunter Team",
    ogDesc:
      "Gép, dedikált számítógép vagy VPS: válaszd ki, hol fusson a csapat, és mindent az asztali appból kezelj.",
    crumb: "Hogyan indítható",
  },
  pt: {
    title: "Como se inicia",
    description:
      "Põe a equipa a funcionar no teu PC com Docker, num computador dedicado ou num VPS sempre ligado. Gere tudo a partir da app de ambiente de trabalho. Requisitos e sistemas suportados.",
    ogTitle: "Como se inicia | Job Hunter Team",
    ogDesc:
      "PC, computador dedicado ou VPS: escolhe onde a equipa funciona e gere tudo a partir da app de ambiente de trabalho.",
    crumb: "Como se inicia",
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

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = META[await getRequestLocale()];
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: m.crumb, path: "/run" }]} />
      {children}
    </>
  );
}
