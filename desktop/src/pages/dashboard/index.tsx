import { useCallback, useEffect, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import type { Locale } from "@/i18n/config";
import { readLocaleCookie } from "@/lib/use-locale";
import { supabase } from "../../lib/supabase";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import DashboardScreen from "./DashboardScreen";
import { loadDashboard, type DashboardData } from "./load-dashboard";

type Load = { state: "loading" } | { state: "ready"; data: DashboardData } | { state: "failed" };

/** web/app/(protected)/dashboard: the user's dashboard, read with their session. */
export default function DashboardPage(_props: PageProps) {
  const [locale] = useState<Locale>(readLocaleCookie);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const read = useCallback(() => {
    loadDashboard(supabase)
      .then((data) => setLoad({ state: "ready", data }))
      .catch(() => setLoad((prev) => (prev.state === "ready" ? prev : { state: "failed" })));
  }, []);

  useEffect(read, [read]);
  useRefresh(read);

  if (load.state === "loading") return <DashboardSkeleton label="Caricamento dashboard" />;
  if (load.state === "failed")
    return (
      <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
        Non riesco a leggere la dashboard. Controlla la connessione e premi «Aggiorna».
      </p>
    );
  return <DashboardScreen data={load.data} locale={locale} />;
}
