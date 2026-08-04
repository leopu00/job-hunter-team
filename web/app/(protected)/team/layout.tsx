import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

// /team è la vista mobile-friendly di STATO + ATTIVITÀ. Resta read-only salvo
// la capacità stop-only d'emergenza documentata nell'interaction-plane.
const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Team — Job Hunter",
    description:
      "Stato e attività del tuo team di agenti AI, ottimizzati anche per telefono — con stop d'emergenza protetto",
  },
  en: {
    title: "Team — Job Hunter",
    description:
      "Your AI agent team's status and activity, mobile friendly — with a protected emergency stop",
  },
  hu: {
    title: "Csapat — Job Hunter",
    description:
      "AI-ügynökcsapatod tevékenysége: ki dolgozott, mennyit és mikor — grafikonok, ügynökönkénti bontás és teljes műveletnapló",
  },
  es: {
    title: "Equipo — Job Hunter",
    description:
      "La actividad de tu equipo de agentes de IA: quién trabajó, cuánto y cuándo — gráficos, desglose por agente y registro completo de acciones",
  },
  de: {
    title: "Team — Job Hunter",
    description:
      "Die Aktivität deines KI-Agenten-Teams: wer wie viel und wann gearbeitet hat — Diagramme, Aufschlüsselung pro Agent und vollständiges Aktionsprotokoll",
  },
  fr: {
    title: "Équipe — Job Hunter",
    description:
      "L'activité de votre équipe d'agents IA : qui a travaillé, combien et quand — graphiques, détail par agent et journal complet des actions",
  },
  pt: {
    title: "Equipe — Job Hunter",
    description:
      "A atividade da sua equipe de agentes de IA: quem trabalhou, quanto e quando — gráficos, detalhamento por agente e registro completo de ações",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
