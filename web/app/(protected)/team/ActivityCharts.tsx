"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  TeamActivity,
  TeamActivityActor,
  TeamActivityRole,
} from "@/lib/team-activity";
import { ROLE_META, timeAgo, dmhm } from "@/lib/team-activity-meta";
import RecentActivityFeed from "@/app/components/RecentActivityFeed";
import {
  TooltipLayer,
  type TipRow,
  type TooltipHandle,
} from "@/app/components/ChartTooltip";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import ActorIcon from "@/app/components/ActorIcon";
import { IconAsleep, IconChevronRight } from "@/app/components/PanelIcons";

const T: Record<
  Locale,
  {
    whenWhoWhat: string;
    zoomBack: string;
    zoomFwd: string;
    scatterHint: string;
    workDistribution: string;
    allRoles: string;
    actions: string;
    unattributed: string;
    donutInstancesHint: (role: string) => string;
    donutRolesHint: string;
    aggregatoHint: string;
    pctActions: (pct: number) => string;
    noActivity: string;
    noActivityHint: string;
    leaderboard: string;
    leaderboardHint: string;
    nInstances: (n: number) => string;
    last: (ago: string) => string;
    volume: string;
    volumeHint: (days: number) => string;
    heatmap: string;
    heatmapHint: string;
    noActivityShort: string;
    action: string;
    actionsLabel: string;
    dayActions: (date: string, n: number) => string;
  }
> = {
  it: {
    whenWhoWhat: "Quando, chi e cosa",
    zoomBack: "Zoom indietro",
    zoomFwd: "Zoom avanti",
    scatterHint:
      "Ogni segno è un'azione all'ora esatta · una corsia per ruolo. Zooma per separare giorni e minuti, poi scorri orizzontalmente.",
    workDistribution: "Distribuzione del lavoro",
    allRoles: "← tutti i ruoli",
    actions: "AZIONI",
    unattributed: "non attribuito",
    donutInstancesHint: (role) =>
      `Dettaglio istanze di ${role}, in quota sul totale del ruolo.`,
    donutRolesHint:
      "Quota di lavoro per ruolo · clicca un ruolo per vederne le istanze.",
    aggregatoHint:
      "Eventi senza id istanza registrato: per l'Analista è l'intera attività (last_checked non salva l'istanza); per gli altri ruoli sono le righe con *_by nullo.",
    pctActions: (pct) => `${pct}% · azioni`,
    noActivity: "Nessuna attività nel periodo selezionato",
    noActivityHint:
      "Prova ad allargare il range, oppure avvia il team perché i grafici si popolino — i dati arrivano da SQLite locale (o da Supabase quando sincronizzato).",
    leaderboard: "Leaderboard · nel periodo",
    leaderboardHint:
      "Per ruolo e per singola istanza (es. scout-1), sul range selezionato.",
    nInstances: (n) => `${n} istanze`,
    last: (ago) => `ultimo ${ago}`,
    volume: "Volume di lavoro nel tempo",
    volumeHint: (days) =>
      `Azioni totali al giorno, scomposte per ruolo · ${days} giorni.`,
    heatmap: "Heatmap attività",
    heatmapHint:
      "Una riga per istanza. L'intensità è relativa al picco giornaliero di ciascuna istanza.",
    noActivityShort: "nessuna attività",
    action: "azione",
    actionsLabel: "azioni",
    dayActions: (date, n) => `${date} · ${n} azioni`,
  },
  en: {
    whenWhoWhat: "When, who and what",
    zoomBack: "Zoom out",
    zoomFwd: "Zoom in",
    scatterHint:
      "Each mark is an action at the exact time · one lane per role. Zoom to separate days and minutes, then scroll horizontally.",
    workDistribution: "Work distribution",
    allRoles: "← all roles",
    actions: "ACTIONS",
    unattributed: "unattributed",
    donutInstancesHint: (role) =>
      `Instance breakdown for ${role}, as a share of the role total.`,
    donutRolesHint: "Work share per role · click a role to see its instances.",
    aggregatoHint:
      "Events with no recorded instance id: for the Analyst it is the whole activity (last_checked does not store the instance); for other roles they are rows with *_by null.",
    pctActions: (pct) => `${pct}% · actions`,
    noActivity: "No activity in the selected period",
    noActivityHint:
      "Try widening the range, or start the team to populate the charts — data comes from local SQLite (or from Supabase when synced).",
    leaderboard: "Leaderboard · in period",
    leaderboardHint:
      "By role and by single instance (e.g. scout-1), over the selected range.",
    nInstances: (n) => `${n} instances`,
    last: (ago) => `last ${ago}`,
    volume: "Work volume over time",
    volumeHint: (days) =>
      `Total actions per day, broken down by role · ${days} days.`,
    heatmap: "Activity heatmap",
    heatmapHint:
      "One row per instance. Intensity is relative to each instance's daily peak.",
    noActivityShort: "no activity",
    action: "action",
    actionsLabel: "actions",
    dayActions: (date, n) => `${date} · ${n} actions`,
  },
  es: {
    whenWhoWhat: "Cuándo, quién y qué",
    zoomBack: "Alejar",
    zoomFwd: "Acercar",
    scatterHint:
      "Cada marca es una acción a la hora exacta · un carril por rol. Haz zoom para separar días y minutos, luego desplázate horizontalmente.",
    workDistribution: "Distribución del trabajo",
    allRoles: "← todos los roles",
    actions: "ACCIONES",
    unattributed: "sin atribuir",
    donutInstancesHint: (role) =>
      `Detalle de instancias de ${role}, como cuota sobre el total del rol.`,
    donutRolesHint:
      "Cuota de trabajo por rol · haz clic en un rol para ver sus instancias.",
    aggregatoHint:
      "Eventos sin id de instancia registrado: para el Analista es toda la actividad (last_checked no guarda la instancia); para los demás roles son las filas con *_by nulo.",
    pctActions: (pct) => `${pct}% · acciones`,
    noActivity: "Sin actividad en el periodo seleccionado",
    noActivityHint:
      "Prueba a ampliar el rango, o inicia el equipo para que los gráficos se llenen — los datos vienen de SQLite local (o de Supabase cuando está sincronizado).",
    leaderboard: "Clasificación · en el periodo",
    leaderboardHint:
      "Por rol y por instancia individual (p. ej. scout-1), sobre el rango seleccionado.",
    nInstances: (n) => `${n} instancias`,
    last: (ago) => `última ${ago}`,
    volume: "Volumen de trabajo en el tiempo",
    volumeHint: (days) =>
      `Acciones totales por día, desglosadas por rol · ${days} días.`,
    heatmap: "Mapa de calor de actividad",
    heatmapHint:
      "Una fila por instancia. La intensidad es relativa al pico diario de cada instancia.",
    noActivityShort: "sin actividad",
    action: "acción",
    actionsLabel: "acciones",
    dayActions: (date, n) => `${date} · ${n} acciones`,
  },
  fr: {
    whenWhoWhat: "Quand, qui et quoi",
    zoomBack: "Dézoomer",
    zoomFwd: "Zoomer",
    scatterHint:
      "Chaque marque est une action à l'heure exacte · une voie par rôle. Zoomez pour séparer les jours et les minutes, puis faites défiler horizontalement.",
    workDistribution: "Répartition du travail",
    allRoles: "← tous les rôles",
    actions: "ACTIONS",
    unattributed: "non attribué",
    donutInstancesHint: (role) =>
      `Détail des instances de ${role}, en part du total du rôle.`,
    donutRolesHint:
      "Part de travail par rôle · cliquez sur un rôle pour voir ses instances.",
    aggregatoHint:
      "Événements sans id d'instance enregistré : pour l'Analyste c'est toute l'activité (last_checked n'enregistre pas l'instance) ; pour les autres rôles ce sont les lignes avec *_by nul.",
    pctActions: (pct) => `${pct}% · actions`,
    noActivity: "Aucune activité sur la période sélectionnée",
    noActivityHint:
      "Essayez d'élargir la plage, ou démarrez l'équipe pour remplir les graphiques — les données proviennent de SQLite local (ou de Supabase une fois synchronisé).",
    leaderboard: "Classement · sur la période",
    leaderboardHint:
      "Par rôle et par instance individuelle (ex. scout-1), sur la plage sélectionnée.",
    nInstances: (n) => `${n} instances`,
    last: (ago) => `dernière ${ago}`,
    volume: "Volume de travail dans le temps",
    volumeHint: (days) =>
      `Actions totales par jour, ventilées par rôle · ${days} jours.`,
    heatmap: "Carte de chaleur d'activité",
    heatmapHint:
      "Une ligne par instance. L'intensité est relative au pic quotidien de chaque instance.",
    noActivityShort: "aucune activité",
    action: "action",
    actionsLabel: "actions",
    dayActions: (date, n) => `${date} · ${n} actions`,
  },
  de: {
    whenWhoWhat: "Wann, wer und was",
    zoomBack: "Verkleinern",
    zoomFwd: "Vergrößern",
    scatterHint:
      "Jede Markierung ist eine Aktion zur genauen Uhrzeit · eine Spur pro Rolle. Zoomen Sie, um Tage und Minuten zu trennen, und scrollen Sie dann horizontal.",
    workDistribution: "Arbeitsverteilung",
    allRoles: "← alle Rollen",
    actions: "AKTIONEN",
    unattributed: "nicht zugeordnet",
    donutInstancesHint: (role) =>
      `Instanz-Aufschlüsselung für ${role}, als Anteil am Rollen-Gesamtwert.`,
    donutRolesHint:
      "Arbeitsanteil pro Rolle · klicken Sie auf eine Rolle, um ihre Instanzen zu sehen.",
    aggregatoHint:
      "Ereignisse ohne erfasste Instanz-ID: beim Analysten ist es die gesamte Aktivität (last_checked speichert die Instanz nicht); bei den anderen Rollen sind es die Zeilen mit *_by null.",
    pctActions: (pct) => `${pct}% · Aktionen`,
    noActivity: "Keine Aktivität im ausgewählten Zeitraum",
    noActivityHint:
      "Versuchen Sie, den Bereich zu erweitern, oder starten Sie das Team, damit sich die Diagramme füllen — die Daten stammen aus lokalem SQLite (oder aus Supabase bei Synchronisierung).",
    leaderboard: "Bestenliste · im Zeitraum",
    leaderboardHint:
      "Nach Rolle und nach einzelner Instanz (z. B. scout-1), über den ausgewählten Bereich.",
    nInstances: (n) => `${n} Instanzen`,
    last: (ago) => `letzte ${ago}`,
    volume: "Arbeitsvolumen im Zeitverlauf",
    volumeHint: (days) =>
      `Gesamtaktionen pro Tag, aufgeschlüsselt nach Rolle · ${days} Tage.`,
    heatmap: "Aktivitäts-Heatmap",
    heatmapHint:
      "Eine Zeile pro Instanz. Die Intensität ist relativ zum täglichen Spitzenwert jeder Instanz.",
    noActivityShort: "keine Aktivität",
    action: "Aktion",
    actionsLabel: "Aktionen",
    dayActions: (date, n) => `${date} · ${n} Aktionen`,
  },
  hu: {
    whenWhoWhat: "Mikor, ki és mit",
    zoomBack: "Kicsinyítés",
    zoomFwd: "Nagyítás",
    scatterHint:
      "Minden jel egy művelet a pontos időpontban · egy sáv szerepenként. Nagyíts a napok és percek elkülönítéséhez, majd görgess vízszintesen.",
    workDistribution: "Munkamegoszlás",
    allRoles: "← minden szerep",
    actions: "MŰVELETEK",
    unattributed: "nincs hozzárendelve",
    donutInstancesHint: (role) =>
      `${role} példányainak részletezése, a szerep összesítésének arányában.`,
    donutRolesHint:
      "Munkaarány szerepenként · kattints egy szerepre a példányai megtekintéséhez.",
    aggregatoHint:
      "Rögzített példányazonosító nélküli események: az Elemzőnél ez a teljes tevékenység (a last_checked nem menti a példányt); a többi szerepnél a *_by null értékű sorok.",
    pctActions: (pct) => `${pct}% · műveletek`,
    noActivity: "Nincs tevékenység a kiválasztott időszakban",
    noActivityHint:
      "Próbáld bővíteni a tartományt, vagy indítsd el a csapatot, hogy a diagramok feltöltődjenek — az adatok a helyi SQLite-ból (vagy szinkronizáláskor a Supabase-ből) érkeznek.",
    leaderboard: "Ranglista · az időszakban",
    leaderboardHint:
      "Szerepenként és egyedi példányonként (pl. scout-1), a kiválasztott tartományon.",
    nInstances: (n) => `${n} példány`,
    last: (ago) => `utolsó ${ago}`,
    volume: "Munkamennyiség az idő során",
    volumeHint: (days) =>
      `Napi összes művelet, szerepenként bontva · ${days} nap.`,
    heatmap: "Tevékenység-hőtérkép",
    heatmapHint:
      "Soronként egy példány. Az intenzitás az egyes példányok napi csúcsához viszonyított.",
    noActivityShort: "nincs tevékenység",
    action: "művelet",
    actionsLabel: "műveletek",
    dayActions: (date, n) => `${date} · ${n} művelet`,
  },
  pt: {
    whenWhoWhat: "Quando, quem e o quê",
    zoomBack: "Reduzir zoom",
    zoomFwd: "Ampliar zoom",
    scatterHint:
      "Cada marca é uma ação na hora exata · uma faixa por função. Amplie para separar dias e minutos, depois role horizontalmente.",
    workDistribution: "Distribuição do trabalho",
    allRoles: "← todas as funções",
    actions: "AÇÕES",
    unattributed: "não atribuído",
    donutInstancesHint: (role) =>
      `Detalhe de instâncias de ${role}, como quota do total da função.`,
    donutRolesHint:
      "Quota de trabalho por função · clique numa função para ver as suas instâncias.",
    aggregatoHint:
      "Eventos sem id de instância registado: para o Analista é toda a atividade (last_checked não guarda a instância); para as outras funções são as linhas com *_by nulo.",
    pctActions: (pct) => `${pct}% · ações`,
    noActivity: "Sem atividade no período selecionado",
    noActivityHint:
      "Tente alargar o intervalo, ou inicie a equipa para preencher os gráficos — os dados vêm do SQLite local (ou do Supabase quando sincronizado).",
    leaderboard: "Classificação · no período",
    leaderboardHint:
      "Por função e por instância individual (ex. scout-1), sobre o intervalo selecionado.",
    nInstances: (n) => `${n} instâncias`,
    last: (ago) => `última ${ago}`,
    volume: "Volume de trabalho ao longo do tempo",
    volumeHint: (days) =>
      `Ações totais por dia, divididas por função · ${days} dias.`,
    heatmap: "Mapa de calor de atividade",
    heatmapHint:
      "Uma linha por instância. A intensidade é relativa ao pico diário de cada instância.",
    noActivityShort: "sem atividade",
    action: "ação",
    actionsLabel: "ações",
    dayActions: (date, n) => `${date} · ${n} ações`,
  },
};

// 'YYYY-MM-DD' → 'DD/MM'
function dm(date: string): string {
  const parts = date.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : date;
}

function dayTotal(counts: Record<TeamActivityRole, number>): number {
  return (
    counts.scout +
    counts.analista +
    counts.scorer +
    counts.scrittore +
    counts.critico
  );
}

// Etichetta istanza:
//  - attore con id proprio (es. scout-1) → l'id.
//  - attore == ruolo (nessun id registrato):
//      · se il ruolo NON ha istanze nominate (Analista) → nome del ruolo;
//      · se il ruolo ha anche istanze nominate → "non attribuito"
//        (le righe dove la colonna *_by era nulla).
function actorLabel(
  a: TeamActivityActor,
  roleLabel: string,
  roleHasNamedInstances: boolean,
  unattributed: string,
): string {
  if (a.actor !== a.role) return a.actor;
  return roleHasNamedInstances ? unattributed : roleLabel;
}

/* ── Scatter temporale isolato (con zoom) ──────────────────────────
   Stato `zoom` interno: lo zoom espande la larghezza del piano (px/giorno)
   → la scrollbar orizzontale serve proprio a esplorare la timeline zoomata,
   separando i giorni e, a zoom alto, i singoli eventi (minuti). Isolato in un
   componente a parte così lo zoom NON ri-renderizza gli altri grafici. */
function TemporalScatter({
  roles,
  timeline,
  fromMs,
  span,
  dates,
  onShow,
  onMove,
  onHide,
  t,
}: {
  roles: TeamActivityRole[];
  timeline: {
    role: TeamActivityRole;
    actor: string;
    ts: string;
    pid: string | null;
  }[];
  fromMs: number;
  span: number;
  dates: string[];
  onShow: (e: React.MouseEvent, title: string, rows: TipRow[]) => void;
  onMove: (e: React.MouseEvent) => void;
  onHide: () => void;
  t: (typeof T)[Locale];
}) {
  const ZOOMS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  const [zoom, setZoom] = useState(1);
  // Misura la larghezza del piano: a zoom 1 il grafico riempie tutto il container
  // (primo giorno a sinistra, ultimo al bordo destro); zoom>1 espande → scroll.
  const planeRef = useRef<HTMLDivElement>(null);
  const [planeW, setPlaneW] = useState(0);
  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;
    const update = () => setPlaneW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const days = dates.length;
  const laneH = 30;
  const scatterW = Math.max(1, Math.round((planeW || 600) * zoom));
  const axisStep = Math.max(
    1,
    Math.ceil(days / Math.max(1, Math.floor(scatterW / 70))),
  );
  const H = roles.length * laneH;
  const zi = ZOOMS.indexOf(zoom);

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="section-label">{t.whenWhoWhat}</div>
        {/* Controllo zoom */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])}
            disabled={zi <= 0}
            className="w-6 h-6 rounded-md text-[12px] font-bold leading-none transition-colors disabled:opacity-30"
            style={{
              background: "transparent",
              color: "var(--color-muted)",
              border: "1px solid var(--color-border)",
            }}
            title={t.zoomBack}
          >
            −
          </button>
          <span className="text-[10px] text-[var(--color-dim)] w-8 text-center tabular-nums">
            {zoom}×
          </span>
          <button
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])}
            disabled={zi >= ZOOMS.length - 1}
            className="w-6 h-6 rounded-md text-[12px] font-bold leading-none transition-colors disabled:opacity-30"
            style={{
              background: "transparent",
              color: "var(--color-muted)",
              border: "1px solid var(--color-border)",
            }}
            title={t.zoomFwd}
          >
            +
          </button>
        </div>
      </div>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">
        {t.scatterHint}
      </p>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="flex">
          {/* Corsie (label ruolo, fisse) */}
          <div className="shrink-0" style={{ width: 96 }}>
            {roles.map((r) => (
              <div
                key={r}
                className="flex items-center gap-1.5"
                style={{ height: laneH }}
              >
                <ActorIcon role={r} size={12} />
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: ROLE_META[r].color }}
                >
                  {ROLE_META[r].label}
                </span>
              </div>
            ))}
          </div>
          {/* Piano scatter — scrollabile */}
          <div ref={planeRef} className="flex-1 overflow-x-auto">
            <div style={{ width: scatterW }}>
              <svg width={scatterW} height={H} viewBox={`0 0 ${scatterW} ${H}`}>
                {roles.map((r, i) => (
                  <line
                    key={r}
                    x1={0}
                    x2={scatterW}
                    y1={i * laneH + laneH / 2}
                    y2={i * laneH + laneH / 2}
                    stroke="var(--color-border)"
                    strokeWidth={1}
                    opacity={0.5}
                  />
                ))}
                {timeline.map((ev, idx) => {
                  const li = roles.indexOf(ev.role);
                  if (li < 0) return null;
                  const t = Date.parse(ev.ts);
                  const frac = Number.isNaN(t)
                    ? 0
                    : Math.max(0, Math.min(1, (t - fromMs) / span));
                  const meta = ROLE_META[ev.role];
                  const label = ev.actor === ev.role ? meta.label : ev.actor;
                  return (
                    <rect
                      key={`${idx}-${ev.ts}`}
                      x={frac * scatterW}
                      y={li * laneH + 6}
                      width={2}
                      height={laneH - 12}
                      rx={1}
                      fill={meta.color}
                      opacity={0.6}
                      className="cursor-default"
                      onMouseEnter={(e) =>
                        onShow(e, `${label} · ${dmhm(ev.ts)}`, [
                          {
                            color: meta.color,
                            label: meta.action,
                            value: ev.pid ? `#${ev.pid}` : "",
                          },
                        ])
                      }
                      onMouseMove={onMove}
                      onMouseLeave={onHide}
                    />
                  );
                })}
              </svg>
              {/* Asse x: tick per giorno (più fitti a zoom alto) */}
              <div className="flex mt-1.5" style={{ width: scatterW }}>
                {dates.map((date, i) => (
                  <div
                    key={date}
                    className="flex-1 text-center overflow-visible whitespace-nowrap"
                    style={{ fontSize: 8, color: "var(--color-dim)" }}
                  >
                    {i % axisStep === 0 ? dm(date) : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Donut interattivo (drill-down ruoli → istanze) ───────────────
   Vista per ruoli; cliccando un ruolo con istanze il donut si "apre" sulle
   sue istanze (scout-1, scout-2…) come spicchi a tonalità decrescenti, con
   legenda dettagliata e back. Stato interno → non ri-renderizza il resto. */
function WorkDonut({
  roles,
  roleTotals,
  actors,
  totalAll,
  onShow,
  onMove,
  onHide,
  t,
}: {
  roles: TeamActivityRole[];
  roleTotals: Record<TeamActivityRole, number>;
  actors: TeamActivityActor[];
  totalAll: number;
  onShow: (e: React.MouseEvent, title: string, rows: TipRow[]) => void;
  onMove: (e: React.MouseEvent) => void;
  onHide: () => void;
  t: (typeof T)[Locale];
}) {
  const [sel, setSel] = useState<TeamActivityRole | null>(null);
  const roleHasInstances = (r: TeamActivityRole) =>
    actors.some((a) => a.role === r && a.actor !== a.role && a.total > 0);

  type Slice = {
    key: string;
    label: string;
    color: string;
    opacity: number;
    value: number;
    pct: number;
    clickable: boolean;
    role?: TeamActivityRole;
    last?: string | null;
    tipTitle: string;
  };

  let slices: Slice[];
  let centerMain: number;
  let centerSub: string;

  if (sel) {
    const meta = ROLE_META[sel];
    const items = actors
      .filter((a) => a.role === sel && a.total > 0)
      .sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
    const hasNamed = items.some((a) => a.actor !== a.role);
    const sum = items.reduce((s, x) => s + x.total, 0) || 1;
    slices = items.map((a, k) => {
      const lbl = actorLabel(a, meta.label, hasNamed, t.unattributed);
      return {
        key: a.actor,
        label: lbl,
        color: meta.color,
        opacity: Math.max(0.32, 1 - k * 0.16),
        value: a.total,
        pct: Math.round((a.total / sum) * 100),
        clickable: false,
        last: a.lastActiveAt,
        tipTitle: lbl,
      };
    });
    centerMain = roleTotals[sel];
    centerSub = meta.label.toUpperCase();
  } else {
    const rs = roles
      .filter((r) => roleTotals[r] > 0)
      .map((r) => ({ r, value: roleTotals[r] }))
      .sort((a, b) => b.value - a.value);
    const sum = rs.reduce((s, x) => s + x.value, 0) || 1;
    slices = rs.map(({ r, value }) => ({
      key: r,
      label: ROLE_META[r].label,
      color: ROLE_META[r].color,
      opacity: 0.9,
      value,
      pct: Math.round((value / sum) * 100),
      clickable: roleHasInstances(r),
      role: r,
      tipTitle: ROLE_META[r].label,
    }));
    centerMain = totalAll;
    centerSub = t.actions;
  }

  const sliceSum = slices.reduce((t, x) => t + x.value, 0) || 1;
  let acc = 0;
  const arcs = slices.map((s) => {
    const frac = s.value / sliceSum;
    const start = acc;
    acc += frac;
    return { ...s, frac, start };
  });

  const R = 60;
  const C = 2 * Math.PI * R;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="section-label">{t.workDistribution}</div>
        {sel && (
          <button
            onClick={() => setSel(null)}
            className="text-[10px] font-semibold rounded-md px-2 py-1 border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)] transition-colors"
          >
            {t.allRoles}
          </button>
        )}
      </div>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">
        {sel ? t.donutInstancesHint(ROLE_META[sel].label) : t.donutRolesHint}
      </p>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 flex flex-col sm:flex-row items-center gap-6">
        {/* Donut SVG */}
        <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
          <svg viewBox="0 0 168 168" width={168} height={168}>
            <g transform="rotate(-90 84 84)">
              {arcs.map((s) => (
                <circle
                  key={s.key}
                  cx={84}
                  cy={84}
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={22}
                  strokeDasharray={`${s.frac * C} ${C - s.frac * C}`}
                  strokeDashoffset={-s.start * C}
                  className={s.clickable ? "cursor-pointer" : "cursor-default"}
                  style={{ opacity: s.opacity }}
                  onClick={
                    s.clickable && s.role ? () => setSel(s.role!) : undefined
                  }
                  onMouseEnter={(e) =>
                    onShow(e, s.tipTitle, [
                      {
                        color: s.color,
                        label: t.pctActions(s.pct),
                        value: String(s.value),
                      },
                    ])
                  }
                  onMouseMove={onMove}
                  onMouseLeave={onHide}
                />
              ))}
            </g>
            <text
              x={84}
              y={80}
              textAnchor="middle"
              className="fill-[var(--color-white)]"
              style={{ fontSize: 22, fontWeight: 700 }}
            >
              {centerMain}
            </text>
            <text
              x={84}
              y={98}
              textAnchor="middle"
              className="fill-[var(--color-dim)]"
              style={{ fontSize: 9, letterSpacing: 1 }}
            >
              {centerSub}
            </text>
          </svg>
        </div>
        {/* Legenda */}
        <div className="flex-1 w-full space-y-2">
          {arcs.map((s) => (
            <div
              key={s.key}
              className={`flex items-center gap-3 rounded-md px-2 py-1 -mx-2 ${
                s.clickable ? "cursor-pointer hover:bg-[var(--color-bg)]" : ""
              }`}
              onClick={
                s.clickable && s.role ? () => setSel(s.role!) : undefined
              }
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: s.color, opacity: s.opacity }}
              />
              {!sel && <ActorIcon role={s.role} size={11} />}
              <span
                className="text-[11px] font-semibold shrink-0 truncate"
                style={{
                  color: sel ? "var(--color-muted)" : s.color,
                  width: sel ? 96 : 80,
                }}
                title={s.label}
              >
                {s.label}
              </span>
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${s.frac * 100}%`,
                    background: s.color,
                    opacity: Math.max(0.55, s.opacity),
                  }}
                />
              </div>
              <span className="text-[11px] font-bold w-10 text-right shrink-0 tabular-nums">
                {s.pct}%
              </span>
              <span className="text-[10px] text-[var(--color-dim)] w-12 text-right shrink-0 tabular-nums">
                {s.value}
              </span>
              {sel ? (
                <span className="text-[9px] text-[var(--color-dim)] w-20 text-right shrink-0 tabular-nums whitespace-nowrap">
                  {t.last(timeAgo(s.last ?? null))}
                </span>
              ) : (
                <span
                  className="text-[10px] w-4 text-right shrink-0"
                  style={{
                    color: "var(--color-dim)",
                    visibility: s.clickable ? "visible" : "hidden",
                  }}
                >
                  <IconChevronRight size={9} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Componente principale ──────────────────────────────────────────
   `showRecent`: il feed "Attività recente" linka a rotte protette
   (/team/log, /positions/[id]) → su pagine pubbliche (case-studies)
   va passato false. Default true per la vista protetta. */
export default function ActivityCharts({
  activity,
  showRecent = true,
  showLeaderboard = true,
  showDonut = true,
  showVolume = true,
}: {
  activity: TeamActivity;
  showRecent?: boolean;
  showLeaderboard?: boolean;
  showDonut?: boolean;
  showVolume?: boolean;
}) {
  const t = T[useLocale()];
  const {
    dates,
    roles,
    actors,
    roleDaily,
    roleTotals,
    totalAll,
    days,
    recent,
  } = activity;

  // Regola UI: nascondiamo agenti/categorie a 0 → mostriamo solo chi ha
  // almeno un dato nel periodo.
  const activeRoles = useMemo(
    () => roles.filter((r) => roleTotals[r] > 0),
    [roles, roleTotals],
  );

  // Leaderboard: raggruppa le istanze per ruolo; ruoli ordinati per azioni nel
  // range, istanze ordinate per azioni nel range.
  const groups = useMemo(() => {
    return roles
      .map((role) => {
        // Solo istanze con almeno un dato nel periodo.
        const items = actors
          .filter((a) => a.role === role && a.total > 0)
          .sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
        const last = items.reduce<string | null>((acc, a) => {
          if (a.lastActiveAt && (!acc || a.lastActiveAt > acc))
            return a.lastActiveAt;
          return acc;
        }, null);
        const maxInstance = Math.max(1, ...items.map((a) => a.total));
        const hasNamed = items.some((a) => a.actor !== a.role);
        return {
          role,
          items,
          total: roleTotals[role],
          last,
          maxInstance,
          hasNamed,
        };
      })
      .filter((g) => g.total > 0) // niente ruoli a 0
      .sort((a, b) => b.total - a.total);
  }, [roles, actors, roleTotals]);

  const maxRole = Math.max(1, ...roles.map((r) => roleTotals[r]));

  const maxDayTotal = useMemo(
    () => Math.max(1, ...roleDaily.map((d) => dayTotal(d.counts))),
    [roleDaily],
  );

  // Heatmap: una riga per ISTANZA, raggruppata per ruolo. Intensità relativa
  // al picco giornaliero della singola istanza.
  const heatRows = useMemo(() => {
    const out: {
      actor: TeamActivityActor;
      max: number;
      label: string;
      aggregated: boolean;
    }[] = [];
    for (const role of roles) {
      const items = actors
        .filter((a) => a.role === role && a.total > 0)
        .sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
      const hasNamed = items.some((a) => a.actor !== a.role);
      for (const a of items) {
        const aggregated = a.actor === a.role;
        out.push({
          actor: a,
          max: Math.max(1, ...a.daily),
          label: actorLabel(a, ROLE_META[role].label, hasNamed, t.unattributed),
          aggregated: aggregated && hasNamed,
        });
      }
    }
    return out;
  }, [roles, actors, t]);

  const tick = Math.max(1, Math.ceil(days / 8));

  // Donut: distribuzione del lavoro per ruolo (quota sul totale).
  // Scatter temporale: posizione x = quota del range, lane per ruolo.
  const fromMs = Date.parse(`${activity.from}T00:00:00Z`);
  const toMs = Date.parse(`${activity.to}T23:59:59Z`);
  const span = Math.max(1, toMs - fromMs);

  /* ── Tooltip custom (hover su barre/celle) ─────────────────────────
     Gli handler chiamano il layer isolato via ref: NON toccano lo stato di
     questo componente, quindi i grafici non si ri-renderizzano sull'hover. */
  const tipRef = useRef<TooltipHandle>(null);
  const showTip = (e: React.MouseEvent, title: string, rows: TipRow[]) =>
    tipRef.current?.show(e.clientX, e.clientY, title, rows);
  const moveTip = (e: React.MouseEvent) =>
    tipRef.current?.move(e.clientX, e.clientY);
  const hideTip = () => tipRef.current?.hide();

  // Leaderboard: dettaglio istanze collassato di default (vediamo i ruoli uno
  // sotto l'altro); click sull'header per espandere.
  const [expanded, setExpanded] = useState<Set<TeamActivityRole>>(new Set());
  const toggleRole = (r: TeamActivityRole) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });

  if (totalAll === 0) {
    return (
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-10 text-center">
        <div className="mb-3 flex justify-center text-[var(--color-dim)]">
          <IconAsleep size={28} />
        </div>
        <div className="text-[13px] text-[var(--color-muted)] font-semibold mb-1">
          {t.noActivity}
        </div>
        <div className="text-[11px] text-[var(--color-dim)]">
          {t.noActivityHint}
        </div>
      </div>
    );
  }

  return (
    <div
      className="space-y-10"
      style={{ animation: "fade-in 0.35s ease both" }}
    >
      {/* ── 0. Attività recente (chi ha fatto le ultime azioni) ──── */}
      {showRecent && (
        <RecentActivityFeed recent={recent} viewAllHref="/team/log" />
      )}
      {/* ── 1. Leaderboard nel periodo (per istanza) ─────────────── */}
      {showLeaderboard && (
        <section>
          <div className="section-label mb-1">{t.leaderboard}</div>
          <p className="text-[10px] text-[var(--color-dim)] mb-4">
            {t.leaderboardHint}
          </p>
          <div className="space-y-3">
            {groups.map((g, i) => {
              const meta = ROLE_META[g.role];
              const showInstances =
                g.items.length > 1 ||
                (g.items.length === 1 && g.items[0].actor !== g.role);
              const isExpanded = expanded.has(g.role);
              return (
                <div
                  key={g.role}
                  className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
                  style={{ animation: `fade-in 0.4s ease ${i * 0.06}s both` }}
                >
                  {/* Header ruolo (cliccabile per espandere le istanze) */}
                  <div
                    className={`flex items-center justify-between mb-3 ${showInstances ? "cursor-pointer select-none" : ""}`}
                    onClick={
                      showInstances ? () => toggleRole(g.role) : undefined
                    }
                    role={showInstances ? "button" : undefined}
                    aria-expanded={showInstances ? isExpanded : undefined}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="text-[9px] w-3 shrink-0 transition-transform"
                        style={{
                          color: "var(--color-dim)",
                          visibility: showInstances ? "visible" : "hidden",
                          transform: isExpanded ? "rotate(90deg)" : "none",
                        }}
                        aria-hidden="true"
                      >
                        <IconChevronRight size={9} />
                      </span>
                      <ActorIcon role={g.role} size={15} />
                      <span
                        className="text-[13px] font-bold"
                        style={{ color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-[var(--color-dim)] truncate">
                        · {meta.verb}
                        {g.items.length > 1
                          ? ` · ${t.nInstances(g.items.length)}`
                          : ""}
                      </span>
                    </div>
                    <span
                      className="text-2xl font-bold leading-none tabular-nums shrink-0"
                      style={{ color: meta.color }}
                    >
                      {g.total}
                    </span>
                  </div>

                  {/* Barra ruolo (quota sul range) */}
                  <div className="flex items-center gap-3">
                    <div
                      className="flex-1 h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--color-border)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(g.total / maxRole) * 100}%`,
                          background: meta.color,
                          opacity: g.total > 0 ? 0.85 : 0,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-[var(--color-dim)] w-20 text-right shrink-0 whitespace-nowrap">
                      {t.last(timeAgo(g.last))}
                    </span>
                  </div>

                  {/* Dettaglio per istanza (visibile solo se espanso) */}
                  {showInstances && isExpanded && (
                    <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
                      {g.items.map((a) => {
                        const isAgg = a.actor === a.role && g.hasNamed;
                        return (
                          <div
                            key={a.actor}
                            className="flex items-center gap-3"
                          >
                            <span
                              className="text-[10px] font-semibold w-24 shrink-0 truncate tabular-nums"
                              style={{
                                color: isAgg
                                  ? "var(--color-dim)"
                                  : "var(--color-muted)",
                              }}
                              title={isAgg ? t.aggregatoHint : a.actor}
                            >
                              {actorLabel(
                                a,
                                ROLE_META[g.role].label,
                                g.hasNamed,
                                t.unattributed,
                              )}
                            </span>
                            <div
                              className="flex-1 h-1 rounded-full overflow-hidden"
                              style={{ background: "var(--color-border)" }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${(a.total / g.maxInstance) * 100}%`,
                                  background: meta.color,
                                  opacity: a.total > 0 ? 0.7 : 0,
                                }}
                              />
                            </div>
                            <span
                              className="text-[11px] font-bold w-8 text-right shrink-0 tabular-nums"
                              style={{ color: meta.color }}
                            >
                              {a.total}
                            </span>
                            <span className="text-[9px] text-[var(--color-dim)] w-20 text-right shrink-0 tabular-nums whitespace-nowrap">
                              {t.last(timeAgo(a.lastActiveAt))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 2. Donut interattivo: distribuzione + drill-down ─────── */}
      {showDonut && (
        <WorkDonut
          roles={roles}
          roleTotals={roleTotals}
          actors={actors}
          totalAll={totalAll}
          onShow={showTip}
          onMove={moveTip}
          onHide={hideTip}
          t={t}
        />
      )}
      {/* ── 3. Timeline impilata (per ruolo) ─────────────────────── */}
      {showVolume && (
        <section>
          <div className="section-label mb-1">{t.volume}</div>
          <p className="text-[10px] text-[var(--color-dim)] mb-4">
            {t.volumeHint(days)}
          </p>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            {/* Legenda (solo ruoli con dati) */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
              {activeRoles.map((r) => (
                <span key={r} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ background: ROLE_META[r].color }}
                  />
                  <span className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]">
                    <ActorIcon role={r} size={10} />
                    {ROLE_META[r].label}
                  </span>
                </span>
              ))}
            </div>
            {/* Barre */}
            <div className="flex items-end gap-[2px]" style={{ height: 170 }}>
              {roleDaily.map((d) => {
                const total = dayTotal(d.counts);
                const hPct = (total / maxDayTotal) * 100;
                const rows: TipRow[] =
                  total > 0
                    ? roles
                        .filter((r) => d.counts[r] > 0)
                        .map((r) => ({
                          color: ROLE_META[r].color,
                          label: ROLE_META[r].label,
                          value: String(d.counts[r]),
                        }))
                    : [
                        {
                          color: "var(--color-dim)",
                          label: t.noActivityShort,
                          value: "",
                        },
                      ];
                return (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col-reverse min-w-0 cursor-default"
                    style={{ height: "100%" }}
                    onMouseEnter={(e) =>
                      showTip(e, t.dayActions(dm(d.date), total), rows)
                    }
                    onMouseMove={moveTip}
                    onMouseLeave={hideTip}
                  >
                    <div
                      className="flex flex-col-reverse rounded-sm overflow-hidden"
                      style={{
                        height: `${hPct}%`,
                        minHeight: total > 0 ? 2 : 0,
                      }}
                    >
                      {roles.map((r) =>
                        d.counts[r] > 0 ? (
                          <div
                            key={r}
                            style={{
                              height: `${(d.counts[r] / total) * 100}%`,
                              background: ROLE_META[r].color,
                              opacity: 0.85,
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Asse x */}
            <div className="flex gap-[2px] mt-1.5">
              {dates.map((date, i) => (
                <div
                  key={date}
                  className="flex-1 text-center min-w-0 overflow-visible whitespace-nowrap"
                  style={{ fontSize: 8, color: "var(--color-dim)" }}
                >
                  {i % tick === 0 ? dm(date) : ""}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 4. Scatter temporale: chi, quando, cosa ──────────────── */}
      <TemporalScatter
        roles={activeRoles}
        timeline={activity.timeline}
        fromMs={fromMs}
        span={span}
        dates={dates}
        onShow={showTip}
        onMove={moveTip}
        onHide={hideTip}
        t={t}
      />
      {/* ── 5. Heatmap istanza × giorno ──────────────────────────── */}
      <section>
        <div className="section-label mb-1">{t.heatmap}</div>
        <p className="text-[10px] text-[var(--color-dim)] mb-4">
          {t.heatmapHint}
        </p>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 overflow-x-auto">
          <div style={{ minWidth: Math.max(360, days * 12) }}>
            {heatRows.map(({ actor: a, max, label, aggregated }) => {
              const meta = ROLE_META[a.role];
              return (
                <div
                  key={`${a.role}-${a.actor}`}
                  className="flex items-center gap-2 mb-1.5"
                >
                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    style={{ width: 116 }}
                    title={
                      aggregated
                        ? t.aggregatoHint
                        : `${meta.label} · ${a.actor}`
                    }
                  >
                    <ActorIcon role={a.role} size={12} />
                    <span
                      className="text-[10px] font-semibold truncate tabular-nums"
                      style={{
                        color: aggregated ? "var(--color-dim)" : meta.color,
                      }}
                    >
                      {label}
                    </span>
                  </div>
                  <div className="flex gap-[2px] flex-1">
                    {a.daily.map((c, di) => {
                      const intensity = c > 0 ? 0.18 + 0.82 * (c / max) : 0;
                      return (
                        <div
                          key={dates[di]}
                          className="flex-1 rounded-[2px] cursor-default"
                          style={{
                            height: 15,
                            background:
                              c > 0 ? meta.color : "var(--color-border)",
                            opacity: c > 0 ? intensity : 0.25,
                          }}
                          onMouseEnter={(e) =>
                            showTip(e, `${label} · ${dm(dates[di])}`, [
                              {
                                color: meta.color,
                                label: c === 1 ? t.action : t.actionsLabel,
                                value: String(c),
                              },
                            ])
                          }
                          onMouseMove={moveTip}
                          onMouseLeave={hideTip}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {/* Asse x heatmap */}
            <div className="flex items-center gap-2 mt-1">
              <div className="shrink-0" style={{ width: 116 }} />
              <div className="flex gap-[2px] flex-1">
                {dates.map((date, i) => (
                  <div
                    key={date}
                    className="flex-1 text-center overflow-visible whitespace-nowrap"
                    style={{ fontSize: 8, color: "var(--color-dim)" }}
                  >
                    {i % tick === 0 ? dm(date) : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <TooltipLayer ref={tipRef} />
    </div>
  );
}
