"use client";

import { useEffect } from "react";
import { markSeen } from "@/lib/seen-positions";

const DWELL_MS = 2000;

// Montato nella pagina di dettaglio posizione: dopo DWELL_MS di permanenza
// la posizione non è più "nuova". Il cleanup cancella il timer, così un
// rimbalzo immediato (back entro 2s) NON la marca come vista.
export default function MarkSeenAfterView({ id }: { id: string }) {
  useEffect(() => {
    const t = window.setTimeout(() => markSeen(id), DWELL_MS);
    return () => window.clearTimeout(t);
  }, [id]);
  return null;
}
