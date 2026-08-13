import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

// /swipe è il triage rapido a carte (stile Tinder) del backlog posizioni:
// I quattro giudizi scrivono position_feedback: sono segnali di gusto per le
// posizioni future e non cambiano score/status della posizione corrente.
// Pensata mobile-first: recensire la coda dal telefono senza aprire le
// posizioni una a una.
const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Swipe — Job Hunter",
    description:
      "Recensisci rapidamente le posizioni dal telefono: assegna un giudizio e il tuo team di agenti AI impara i tuoi gusti per le offerte future",
  },
  en: {
    title: "Swipe — Job Hunter",
    description:
      "Quickly review positions from your phone: give a verdict and your AI agent team learns your taste for future openings",
  },
  hu: {
    title: "Swipe — Job Hunter",
    description:
      "Értékeld gyorsan a pozíciókat telefonról: adj véleményt, és az AI-ügynökcsapatod tanul belőle a jövőbeli ajánlatokhoz",
  },
  es: {
    title: "Swipe — Job Hunter",
    description:
      "Valora rápidamente posiciones desde el móvil: da tu opinión y tu equipo de agentes de IA aprende tus gustos para ofertas futuras",
  },
  de: {
    title: "Swipe — Job Hunter",
    description:
      "Bewerte Stellen schnell auf dem Handy: Gib dein Urteil ab, damit dein KI-Agenten-Team deine Vorlieben für künftige Angebote lernt",
  },
  fr: {
    title: "Swipe — Job Hunter",
    description:
      "Évaluez rapidement les postes depuis votre téléphone : donnez votre avis et votre équipe d'agents IA apprend vos goûts pour les offres futures",
  },
  pt: {
    title: "Swipe — Job Hunter",
    description:
      "Avalie rapidamente as vagas pelo telemóvel: dê a sua opinião e a sua equipa de agentes de IA aprende os seus gostos para ofertas futuras",
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
