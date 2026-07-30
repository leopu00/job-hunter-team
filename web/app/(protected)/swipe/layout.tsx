import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

// /swipe è il triage rapido a carte (stile Tinder) del backlog posizioni:
// swipe a destra = mi interessa (position_feedback like → il team impara il
// gusto), swipe a sinistra = scarta (user-exclude → il team smette di
// lavorarci). Pensata mobile-first: smaltire la coda dal telefono senza
// aprire le posizioni una a una.
const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Swipe — Job Hunter",
    description:
      "Triage rapido delle posizioni: scorri a destra se ti interessa, a sinistra per scartare — il tuo team di agenti AI impara i tuoi gusti",
  },
  en: {
    title: "Swipe — Job Hunter",
    description:
      "Quick position triage: swipe right if interested, left to discard — your AI agent team learns your taste",
  },
  hu: {
    title: "Swipe — Job Hunter",
    description:
      "Gyors állás-válogatás: húzd jobbra, ha érdekel, balra, ha nem — az AI-ügynökcsapatod tanulja az ízlésedet",
  },
  es: {
    title: "Swipe — Job Hunter",
    description:
      "Selección rápida de posiciones: desliza a la derecha si te interesa, a la izquierda para descartar — tu equipo de agentes de IA aprende tus gustos",
  },
  de: {
    title: "Swipe — Job Hunter",
    description:
      "Schnelles Stellen-Triage: nach rechts wischen bei Interesse, nach links zum Aussortieren — dein KI-Agenten-Team lernt deinen Geschmack",
  },
  fr: {
    title: "Swipe — Job Hunter",
    description:
      "Tri rapide des postes : balayez à droite si intéressé, à gauche pour écarter — votre équipe d'agents IA apprend vos goûts",
  },
  pt: {
    title: "Swipe — Job Hunter",
    description:
      "Triagem rápida de vagas: deslize para a direita se interessar, para a esquerda para descartar — sua equipe de agentes de IA aprende seu gosto",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function SwipeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
