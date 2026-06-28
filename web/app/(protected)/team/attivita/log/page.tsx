import { getTeamActivityLog } from "@/lib/queries";
import ActivityLogTable from "./ActivityLogTable";
import { LogPageHeader } from "../ActivityHeader";

export const dynamic = "force-dynamic";

export default async function ActivityLogPage() {
  const events = await getTeamActivityLog();

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <LogPageHeader total={events.length} />

      <ActivityLogTable events={events} />
    </div>
  );
}
