"use client";

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import AgentLoadingSkeleton from "../_components/AgentLoadingSkeleton";

const T: Record<Locale, string> = {
  it: "Caricamento Scorer",
  en: "Loading Scorer",
  es: "Cargando Evaluador",
  fr: "Chargement de l'Évaluateur",
  de: "Bewerter wird geladen",
  hu: "Pontozó betöltése",
  pt: "Carregando Avaliador",
};

export default function AgentLoading() {
  return <AgentLoadingSkeleton label={T[useLocale()]} />;
}
