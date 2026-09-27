/**
 * Web texts that say something false inside the desktop, replaced with a
 * desktop-only wording while the web stays unchanged (operator's decision,
 * 27/09). The replacement happens when Vite loads the web file (dev, build
 * and vitest alike): see desktopTexts() in vite.config.ts.
 *
 * Each `from` must be found in its file exactly once: if the web rewords
 * one, the build fails here instead of silently shipping the old text.
 */
export type TextOverride = { file: string; from: string; to: string };

const ACTIVITY_CHARTS = "web/app/(protected)/team/ActivityCharts.tsx";

// /team with no activity: the web says the data comes from a local SQLite,
// which the desktop never reads. It arrives when the team syncs.
export const TEXT_OVERRIDES: TextOverride[] = [
  {
    file: ACTIVITY_CHARTS,
    from: "Prova ad allargare il range, oppure avvia il team perché i grafici si popolino — i dati arrivano da SQLite locale (o da Supabase quando sincronizzato).",
    to: "Nessun dato del team: arriva quando il tuo team sincronizza col cloud.",
  },
  {
    file: ACTIVITY_CHARTS,
    from: "Try widening the range, or start the team to populate the charts — data comes from local SQLite (or from Supabase when synced).",
    to: "No team data yet: it arrives when your team syncs with the cloud.",
  },
  {
    file: ACTIVITY_CHARTS,
    from: "Prueba a ampliar el rango, o inicia el equipo para que los gráficos se llenen — los datos vienen de SQLite local (o de Supabase cuando está sincronizado).",
    to: "Aún no hay datos del equipo: llegan cuando tu equipo se sincroniza con la nube.",
  },
  {
    file: ACTIVITY_CHARTS,
    from: "Essayez d'élargir la plage, ou démarrez l'équipe pour remplir les graphiques — les données proviennent de SQLite local (ou de Supabase une fois synchronisé).",
    to: "Pas encore de données de l'équipe : elles arrivent quand votre équipe se synchronise avec le cloud.",
  },
  {
    file: ACTIVITY_CHARTS,
    from: "Versuchen Sie, den Bereich zu erweitern, oder starten Sie das Team, damit sich die Diagramme füllen — die Daten stammen aus lokalem SQLite (oder aus Supabase bei Synchronisierung).",
    to: "Noch keine Teamdaten: Die Daten kommen, sobald Ihr Team mit der Cloud synchronisiert.",
  },
  {
    file: ACTIVITY_CHARTS,
    from: "Próbáld bővíteni a tartományt, vagy indítsd el a csapatot, hogy a diagramok feltöltődjenek — az adatok a helyi SQLite-ból (vagy szinkronizáláskor a Supabase-ből) érkeznek.",
    to: "Még nincsenek csapatadatok: akkor érkeznek, amikor a csapatod szinkronizál a felhővel.",
  },
  {
    file: ACTIVITY_CHARTS,
    from: "Tente alargar o intervalo, ou inicie a equipa para preencher os gráficos — os dados vêm do SQLite local (ou do Supabase quando sincronizado).",
    to: "Ainda não há dados da equipa: chegam quando a sua equipa sincronizar com a nuvem.",
  },
];

/**
 * Applies the overrides meant for `id` (an absolute module path ending with
 * the override's file) to `code`. Throws when a `from` is not there exactly
 * once.
 */
export function applyTextOverrides(id: string, code: string, overrides: TextOverride[] = TEXT_OVERRIDES): string {
  const path = id.split("?")[0].replace(/\\/g, "/");
  let out = code;
  for (const o of overrides) {
    if (!path.endsWith(`/${o.file}`)) continue;
    const count = out.split(o.from).length - 1;
    if (count !== 1) {
      throw new Error(`desktop text override: expected the web text once in ${o.file}, found ${count}: ${o.from.slice(0, 60)}…`);
    }
    out = out.replace(o.from, () => o.to);
  }
  return out;
}
