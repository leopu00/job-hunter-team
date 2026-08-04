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
      "Configura e controlla il team dall'app desktop sul tuo PC, su un computer dedicato o su una VPS. La CLI resta disponibile per chi preferisce il terminale.",
    ogTitle: "Come si avvia | Job Hunter Team",
    ogDesc:
      "PC, computer dedicato o VPS: scegli dove far girare la squadra e gestiscila dall'app desktop.",
    crumb: "Come si avvia",
  },
  en: {
    title: "How to run it",
    description:
      "Set up and control the team from the desktop app on your PC, a dedicated computer, or a VPS. The CLI remains available if you prefer the terminal.",
    ogTitle: "How to run it | Job Hunter Team",
    ogDesc:
      "PC, dedicated computer or VPS: choose where the team runs and manage it from the desktop app.",
    crumb: "How to run it",
  },
  es: {
    title: "Cómo se inicia",
    description:
      "Configura y controla el equipo desde la app de escritorio en tu PC, en un ordenador dedicado o en una VPS. La CLI sigue disponible si prefieres la terminal.",
    ogTitle: "Cómo se inicia | Job Hunter Team",
    ogDesc:
      "PC, ordenador dedicado o VPS: elige dónde funciona el equipo y gestiónalo desde la app de escritorio.",
    crumb: "Cómo se inicia",
  },
  fr: {
    title: "Comment le lancer",
    description:
      "Configurez et pilotez l'équipe depuis l'app de bureau sur votre PC, un ordinateur dédié ou un VPS. La CLI reste disponible si vous préférez le terminal.",
    ogTitle: "Comment le lancer | Job Hunter Team",
    ogDesc:
      "PC, ordinateur dédié ou VPS : choisissez où l'équipe tourne et pilotez-la depuis l'app de bureau.",
    crumb: "Comment le lancer",
  },
  de: {
    title: "So wird es gestartet",
    description:
      "Richte das Team über die Desktop-App auf deinem PC, einem dedizierten Computer oder einem VPS ein und steuere es von dort. Die CLI bleibt verfügbar, wenn du das Terminal bevorzugst.",
    ogTitle: "So wird es gestartet | Job Hunter Team",
    ogDesc:
      "PC, dedizierter Computer oder VPS: Wähle, wo das Team läuft, und steuere es über die Desktop-App.",
    crumb: "So wird es gestartet",
  },
  hu: {
    title: "Hogyan indítható",
    description:
      "Az asztali appból állítsd be és irányítsd a csapatot a saját gépeden, egy dedikált számítógépen vagy VPS-en. Ha a terminált kedveled, a CLI továbbra is elérhető.",
    ogTitle: "Hogyan indítható | Job Hunter Team",
    ogDesc:
      "Saját gép, dedikált számítógép vagy VPS: válaszd ki, hol fusson a csapat, és az asztali appból kezeld.",
    crumb: "Hogyan indítható",
  },
  pt: {
    title: "Como se inicia",
    description:
      "Configura e controla a equipa a partir da app de ambiente de trabalho no teu PC, num computador dedicado ou num VPS. A CLI continua disponível se preferires o terminal.",
    ogTitle: "Como se inicia | Job Hunter Team",
    ogDesc:
      "PC, computador dedicado ou VPS: escolhe onde a equipa funciona e gere-a a partir da app de ambiente de trabalho.",
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
