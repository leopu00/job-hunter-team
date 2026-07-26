"use client";

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import AgentLoadingSkeleton from "../_components/AgentLoadingSkeleton";

const T: Record<Locale, string> = {
  it: "Caricamento Analista",
  en: "Loading Analyst",
  es: "Cargando Analista",
  fr: "Chargement de l'Analyste",
  de: "Analyst wird geladen",
  hu: "Elemző betöltése",
  pt: "Carregando Analista",
};

export default function AgentLoading() {
  return <AgentLoadingSkeleton label={T[useLocale()]} />;
}
