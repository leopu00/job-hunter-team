import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Profilo — Job Hunter",
    description:
      "Profilo candidato: avatar, competenze, esperienza, CV e statistiche di completamento",
  },
  en: {
    title: "Profile — Job Hunter",
    description:
      "Candidate profile: avatar, skills, experience, CV and completion statistics",
  },
  hu: {
    title: "Profil — Job Hunter",
    description:
      "Jelölt profilja: avatár, készségek, tapasztalat, önéletrajz és kitöltési statisztikák",
  },
  es: {
    title: "Perfil — Job Hunter",
    description:
      "Perfil del candidato: avatar, habilidades, experiencia, CV y estadísticas de completitud",
  },
  de: {
    title: "Profil — Job Hunter",
    description:
      "Kandidatenprofil: Avatar, Fähigkeiten, Erfahrung, Lebenslauf und Vervollständigungsstatistik",
  },
  fr: {
    title: "Profil — Job Hunter",
    description:
      "Profil du candidat : avatar, compétences, expérience, CV et statistiques de complétion",
  },
  pt: {
    title: "Perfil — Job Hunter",
    description:
      "Perfil do candidato: avatar, habilidades, experiência, CV e estatísticas de preenchimento",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
