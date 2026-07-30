import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

// /team è la pagina ATTIVITÀ del team (dev2 2026-07-03): i metadata descrivono
// chi ha lavorato, quanto e quando — non più la gestione/controllo del team.
const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Team — Job Hunter",
    description:
      "L'attività del tuo team di agenti AI: chi ha lavorato, quanto e quando — grafici, dettaglio per agente e log completo delle azioni",
  },
  en: {
    title: "Team — Job Hunter",
    description:
      "Your AI agent team's activity: who worked, how much and when — charts, per-agent breakdown and full action log",
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
