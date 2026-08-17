// Metadati di presentazione degli agenti + formatter condivisi tra la pagina
// /team (ActivityCharts), la card Attività recente in dashboard e le legende
// dei grafici nei case study.
//
// Le facce degli attori NON stanno qui: le disegna `components/ActorIcon.tsx`,
// un <svg> per ruolo. Fino a #166 questo file portava anche un campo `emoji`,
// e con lui il commento — sbagliato — che quelle faccine fossero «le stesse di
// RecentPositionsTable / positions»: quella tabella non ha nemmeno una colonna
// attore, e l'affermazione era finita pari pari nel testo di #160. Un commento
// che dichiara una parentela inesistente non e' un dettaglio: e' la fonte da
// cui la parentela viene poi citata come fatto.
import type { TeamActivityRole } from "./team-activity";

export const ROLE_META: Record<
  TeamActivityRole,
  { label: string; color: string; verb: string; action: string }
> = {
  scout: {
    label: "Scout",
    color: "#2196f3",
    verb: "posizioni trovate",
    action: "ha trovato una posizione",
  },
  analista: {
    label: "Analista",
    color: "#00e676",
    verb: "posizioni analizzate",
    action: "ha analizzato una posizione",
  },
  scorer: {
    label: "Scorer",
    color: "#b388ff",
    verb: "score assegnati",
    action: "ha assegnato uno score",
  },
  scrittore: {
    label: "Scrittore",
    color: "#ffd600",
    verb: "CV scritti",
    action: "ha scritto un CV",
  },
  critico: {
    label: "Critico",
    color: "#ff6ac1",
    verb: "review completate",
    action: "ha completato una review",
  },
};

// Tempo relativo in italiano (es. "2m fa", "3h fa", "5g fa").
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 0) return "ora";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ora";
  if (min < 60) return `${min}m fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}g fa`;
  const mo = Math.floor(d / 30);
  return `${mo} mes${mo === 1 ? "e" : "i"} fa`;
}

// ISO → 'DD/MM HH:MM' (ora locale).
export function dmhm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
