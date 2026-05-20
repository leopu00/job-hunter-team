// Helpers di formattazione tempo per UI. Server-safe (niente window).
// Logica originale duplicata da web/app/(protected)/team/v2/page.tsx —
// quando team/v2 verra' rivisitato, convertire l'import.

export function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

// Orario preciso (HH:MM:SS se oggi, altrimenti YYYY-MM-DD HH:MM) +
// tempo trascorso tra parentesi. Risolve l'ambiguita' di "2h ago" che
// raggruppa righe trovate in momenti diversi nello stesso slot.
export function formatFoundAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const head = sameDay
    ? time
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${head} (${formatRelative(iso)})`;
}
