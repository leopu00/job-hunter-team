"use client";

import { useLocale } from "@/lib/use-locale";
import DashboardSkeleton from "../_components/DashboardSkeleton";

const T: Record<string, Record<string, string>> = {
  loading_dashboard: {
    it: "Caricamento dashboard",
    en: "Loading dashboard",
    hu: "Irányítópult betöltése",
    es: "Cargando panel",
    de: "Dashboard wird geladen",
    fr: "Chargement du tableau de bord",
    pt: "Carregando painel",
  },
};

export default function DashboardLoading() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  return <DashboardSkeleton label={tr("loading_dashboard")} />;
}
