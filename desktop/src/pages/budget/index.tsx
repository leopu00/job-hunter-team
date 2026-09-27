import { useCallback, useEffect, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import { readSpend, type SpendRead } from "../../lib/spend";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import BudgetScreen from "./BudgetScreen";

/** /budget: a desktop page, no web counterpart. What it reads: BudgetScreen. */
export default function BudgetPage(_props: PageProps) {
  const [spend, setSpend] = useState<SpendRead | null>(null);

  const read = useCallback(() => {
    let live = true;
    void readSpend().then((next) => {
      // A failed refresh keeps what is on screen.
      if (live) setSpend((prev) => (next.state === "failed" && prev?.state === "ready" ? prev : next));
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(read, [read]);
  useRefresh(read);

  if (!spend) return <DashboardSkeleton label="Caricamento budget" />;
  return <BudgetScreen spend={spend} />;
}
