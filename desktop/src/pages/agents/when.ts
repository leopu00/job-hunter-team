/** Timestamps as the agents page shows them. «—» when there is none. */

/** In a list row: the time if today, the day otherwise (as FLEET's quandoElenco). */
export function whenShort(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "—";
  const d = new Date(t);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

/** In the bar and the moves: day and time, plus how long ago. */
export function whenLong(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "—";
  const at = new Date(t).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${at} (${ago(now - t)})`;
}

function ago(ms: number): string {
  if (ms < 60_000) return "adesso";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h fa`;
  return `${Math.floor(h / 24)} giorni fa`;
}
