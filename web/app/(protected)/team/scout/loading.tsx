"use client";

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import AgentLoadingSkeleton from "../_components/AgentLoadingSkeleton";

const T: Record<Locale, string> = {
  it: "Caricamento Scout",
  en: "Loading Scout",
  es: "Cargando Explorador",
  fr: "Chargement de l'Éclaireur",
  de: "Späher wird geladen",
  hu: "Felderítő betöltése",
  pt: "Carregando Explorador",
};

export default function AgentLoading() {
  return <AgentLoadingSkeleton label={T[useLocale()]} />;
}
