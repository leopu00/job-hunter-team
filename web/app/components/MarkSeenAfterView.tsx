"use client";

import { useEffect } from "react";
import { markSeen } from "@/lib/seen-positions";

const DWELL_MS = 2000;

// Montato nella pagina di dettaglio posizione: dopo DWELL_MS di permanenza
// la posizione non è più "nuova". Il cleanup cancella il timer, così un
// rimbalzo immediato (back entro 2s) NON la marca come vista.
//
// Doppia scrittura: localStorage (feedback immediato, unica fonte in
// local mode) + POST fire-and-forget su position_views per lo stato
// cross-device. Se la POST fallisce resta il localStorage: al prossimo
// render server il pallino ricompare sugli ALTRI device, mai su questo.
export default function MarkSeenAfterView({ id }: { id: string }) {
  useEffect(() => {
    const t = window.setTimeout(() => {
      markSeen(id);
      fetch("/api/positions/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_id: id }),
        keepalive: true,
      }).catch(() => {});
    }, DWELL_MS);
    return () => window.clearTimeout(t);
  }, [id]);
  return null;
}
