"use client";

import { useLocale } from "@/lib/use-locale";
import DashboardSkeleton from "../_components/DashboardSkeleton";

const T: Record<string, Record<string, string>> = {
  loading_map: {
    it: "Caricamento mappa",
    en: "Loading map",
    hu: "Térkép betöltése",
    es: "Cargando mapa",
    de: "Karte wird geladen",
    fr: "Chargement de la carte",
    pt: "Carregando mapa",
  },
};

export default function MapLoading() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  return <DashboardSkeleton label={tr("loading_map")} />;
}
