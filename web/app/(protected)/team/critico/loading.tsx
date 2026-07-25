"use client";

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import AgentLoadingSkeleton from "../_components/AgentLoadingSkeleton";

const T: Record<Locale, string> = {
  it: "Caricamento Critico",
  en: "Loading Critic",
  es: "Cargando Crítico",
  fr: "Chargement du Critique",
  de: "Kritiker wird geladen",
  hu: "Kritikus betöltése",
  pt: "Carregando Crítico",
};

export default function AgentLoading() {
  return <AgentLoadingSkeleton label={T[useLocale()]} />;
}
