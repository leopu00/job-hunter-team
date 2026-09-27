import { useCallback, useEffect, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import { readSpend, type SpendRead } from "../../lib/spend";
import { supabase } from "../../lib/supabase";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import BudgetScreen from "./BudgetScreen";
import { loadUsage, type UsageRead } from "./load-usage";

/** /budget: a desktop page, no web counterpart. What it reads: BudgetScreen. */
export default function BudgetPage(_props: PageProps) {
  const [spend, setSpend] = useState<SpendRead | null>(null);
  const [usage, setUsage] = useState<UsageRead | null>(null);

  const read = useCallback(() => {
    let live = true;
    void readSpend().then((next) => {
      // A failed refresh keeps what is on screen.
      if (live) setSpend((prev) => (next.state === "failed" && prev?.state === "ready" ? prev : next));
    });
    // The tmux team's usage is the cloud's: its own read, so one source failing does not hide the other.
    loadUsage(supabase)
      .then((samples) => live && setUsage({ state: "ready", samples }))
      .catch(() => live && setUsage((prev) => (prev?.state === "ready" ? prev : { state: "failed" })));
    return () => {
      live = false;
    };
  }, []);

  useEffect(read, [read]);
  useRefresh(read);

  if (!spend) return <DashboardSkeleton label="Caricamento budget" />;
  return <BudgetScreen spend={spend} usage={usage} />;
}
