import { intlTag } from "@/lib/locale-tag";

/**
 * Data e ora brevi di una riga, nella lingua dell'interfaccia: solo l'ora se
 * è oggi, altrimenti giorno e mese con l'ora («10/03, 10:00 AM» in inglese,
 * «03/10, 10:00» in italiano).
 *
 * Una funzione sola per la tabella Posizioni e per le tabelle della
 * Dashboard: prima la Dashboard scriveva sempre «gg/mm hh:mm», e lo stesso
 * dato appariva «01/10 10:00» lì e «10/01, 10:00 AM» in Posizioni, con
 * l'interfaccia in inglese.
 */
export function formatShortStamp(
  ts: string | null | undefined,
  locale: string,
  now: Date = new Date(),
): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(intlTag(locale), {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleString(intlTag(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
