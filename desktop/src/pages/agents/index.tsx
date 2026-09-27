import { useCallback, useEffect, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import { supabase } from "../../lib/supabase";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import AgentsScreen from "./AgentsScreen";
import { AGENTS, loadAgents, type AgentsData } from "./load-agents";

type Load = { state: "loading" } | { state: "ready"; data: AgentsData } | { state: "failed" };

/**
 * /agents?agent=<role>: a desktop page, no web counterpart. Without a role
 * (or with one that is not in the team) it opens the Capitano. The agent is
 * in the query string, not the path: the shell remounts a page on a new
 * path, and choosing an agent must not read everything again.
 */
export default function AgentsPage({ search }: PageProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const read = useCallback(() => {
    let live = true;
    loadAgents(supabase)
      .then((data) => live && setLoad({ state: "ready", data }))
      .catch(() => live && setLoad((prev) => (prev.state === "ready" ? prev : { state: "failed" })));
    return () => {
      live = false;
    };
  }, []);

  useEffect(read, [read]);
  useRefresh(read);

  if (load.state === "loading") return <DashboardSkeleton label="Caricamento agenti" />;
  if (load.state === "failed")
    return (
      <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
        Non riesco a leggere gli agenti. Controlla la connessione e premi «Aggiorna».
      </p>
    );
  const selected = AGENTS.find((a) => a.role === search.get("agent")) ?? AGENTS[0];
  return <AgentsScreen data={load.data} selected={selected} />;
}
