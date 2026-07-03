import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Assistente — Job Hunter",
    description:
      "Agente Assistente: ti aiuta a configurare il sistema e a navigare la piattaforma",
  },
  en: {
    title: "Assistant — Job Hunter",
    description:
      "Assistant Agent: helps you configure the system and navigate the platform",
  },
  hu: {
    title: "Asszisztens — Job Hunter",
    description:
      "Asszisztens ügynök: segít a rendszer beállításában és a platformon való eligazodásban",
  },
  es: {
    title: "Asistente — Job Hunter",
    description:
      "Agente Asistente: te ayuda a configurar el sistema y a navegar por la plataforma",
  },
  de: {
    title: "Assistent — Job Hunter",
    description:
      "Assistent-Agent: hilft dir bei der Konfiguration des Systems und der Navigation auf der Plattform",
  },
  fr: {
    title: "Assistant — Job Hunter",
    description:
      "Agent Assistant : vous aide à configurer le système et à naviguer sur la plateforme",
  },
  pt: {
    title: "Assistente — Job Hunter",
    description:
      "Agente Assistente: ajuda você a configurar o sistema e a navegar pela plataforma",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function AssistenteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
