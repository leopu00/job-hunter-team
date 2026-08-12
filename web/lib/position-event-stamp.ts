import { intlTag } from "@/lib/locale-tag";

// Timbro esatto condiviso dalle superfici posizione. Data e ora restano
// sempre insieme, anche per gli eventi di oggi: nella lista e nel dettaglio
// la stessa candidatura deve raccontare lo stesso momento.
export function formatPositionEventStamp(
  ts: string | null | undefined,
  locale: string,
): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(intlTag(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
