"use client";

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import AgentLoadingSkeleton from "../_components/AgentLoadingSkeleton";

const T: Record<Locale, string> = {
  it: "Caricamento Scrittore",
  en: "Loading Writer",
  es: "Cargando Redactor",
  fr: "Chargement du Rédacteur",
  de: "Verfasser wird geladen",
  hu: "Író betöltése",
  pt: "Carregando Redator",
};

export default function AgentLoading() {
  return <AgentLoadingSkeleton label={T[useLocale()]} />;
}
