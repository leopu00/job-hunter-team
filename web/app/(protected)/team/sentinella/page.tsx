"use client";

// Questa pagina NON e' piu' un agente LLM: e' il dashboard di monitoraggio
// del bridge rate-limit (sentinel-bridge.py). Il bridge calcola e notifica
// policy cambiate direttamente al CAPITANO via [BRIDGE ORDER], zero LLM
// nel loop di monitoraggio. Qui l'utente vede solo i dati storici.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTeamCommandPoller } from "@/app/hooks/useTeamCommandPoller";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const LOCALE_TAG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};

type Strings = {
  dashboard: string;
  team: string;
  sentinel: string;
  subtitle: string;
  connecting: string;
  tmuxActive: string;
  tmuxInactive: string;
  openTerminal: string;
  openPowershell: string;
  tickInterval: string;
  minHint: string;
  saving: string;
  save: string;
  historyLoadError: string;
  loadingHistory: string;
  velSmoothed: string;
  velIdeal: string;
  projection: string;
  lastTick: string;
  terminalOutput: string;
  refreshSentinella: string;
  noOutput: string;
  chartEmpty: string;
  legendProjection: string;
  legendIdeal: string;
  startSending: string;
  startQueued: string;
  startStarting: string;
  startSentinel: string;
  startTimeout: string;
  saveError: string;
  networkError: string;
  unknownError: string;
  fetchFailed: string;
  savedTick: (min: number) => string;
  samplesLine: (n: number) => string;
};

const T: Record<Locale, Strings> = {
  it: {
    dashboard: "Dashboard",
    team: "Team",
    sentinel: "Sentinella",
    subtitle:
      "Monitor rate-limit e budget del provider AI attivo. Tick ogni 10 min, UI aggiorna ogni 30 s.",
    connecting: "connessione…",
    tmuxActive: "sessione tmux attiva",
    tmuxInactive: "sessione tmux inattiva",
    openTerminal: "apri terminale",
    openPowershell: "apri powershell",
    tickInterval: "Intervallo tick",
    minHint: "min (0.5 = 30s)",
    saving: "Salvo…",
    save: "Salva",
    historyLoadError: "Errore caricamento storico: ",
    loadingHistory: "Caricamento storico…",
    velSmoothed: "vel. smussata",
    velIdeal: "vel. ideale",
    projection: "proiezione",
    lastTick: "ultimo tick",
    terminalOutput: "Output terminale",
    refreshSentinella: "aggiornamento ogni 5s · sessione SENTINELLA",
    noOutput: "nessun output…",
    chartEmpty: "In attesa del primo tick della Sentinella…",
    legendProjection: "proiezione",
    legendIdeal: "ideale",
    startSending: "Invio…",
    startQueued: "In coda sulla VPS…",
    startStarting: "Avvio in corso…",
    startSentinel: "Avvia Sentinella",
    startTimeout: "Timeout: il subscriber sulla VPS non risponde.",
    saveError: "Errore salvataggio",
    networkError: "Errore di rete",
    unknownError: "errore sconosciuto",
    fetchFailed: "fetch failed",
    savedTick: (min) => `Salvato (${min} min). Attivo entro ~15s.`,
    samplesLine: (n) =>
      `${n} campionamenti dalla sessione corrente (ultimi 500).`,
  },
  en: {
    dashboard: "Dashboard",
    team: "Team",
    sentinel: "Sentinel",
    subtitle:
      "Monitors the active AI provider's rate-limit and budget. Tick every 10 min, UI refreshes every 30 s.",
    connecting: "connecting…",
    tmuxActive: "tmux session active",
    tmuxInactive: "tmux session inactive",
    openTerminal: "open terminal",
    openPowershell: "open powershell",
    tickInterval: "Tick interval",
    minHint: "min (0.5 = 30s)",
    saving: "Saving…",
    save: "Save",
    historyLoadError: "History load error: ",
    loadingHistory: "Loading history…",
    velSmoothed: "smoothed vel.",
    velIdeal: "ideal vel.",
    projection: "projection",
    lastTick: "last tick",
    terminalOutput: "Terminal output",
    refreshSentinella: "refresh every 5s · SENTINELLA session",
    noOutput: "no output…",
    chartEmpty: "Waiting for the Sentinel's first tick…",
    legendProjection: "projection",
    legendIdeal: "ideal",
    startSending: "Sending…",
    startQueued: "Queued on the VPS…",
    startStarting: "Starting…",
    startSentinel: "Start Sentinel",
    startTimeout: "Timeout: the subscriber on the VPS is not responding.",
    saveError: "Save error",
    networkError: "Network error",
    unknownError: "unknown error",
    fetchFailed: "fetch failed",
    savedTick: (min) => `Saved (${min} min). Active within ~15s.`,
    samplesLine: (n) => `${n} samples from the current session (last 500).`,
  },
  es: {
    dashboard: "Panel",
    team: "Equipo",
    sentinel: "Centinela",
    subtitle:
      "Monitorea el límite de tasa y el presupuesto del proveedor de IA activo. Tick cada 10 min, la interfaz se actualiza cada 30 s.",
    connecting: "conectando…",
    tmuxActive: "sesión tmux activa",
    tmuxInactive: "sesión tmux inactiva",
    openTerminal: "abrir terminal",
    openPowershell: "abrir powershell",
    tickInterval: "Intervalo de tick",
    minHint: "min (0.5 = 30s)",
    saving: "Guardando…",
    save: "Guardar",
    historyLoadError: "Error al cargar el historial: ",
    loadingHistory: "Cargando historial…",
    velSmoothed: "vel. suavizada",
    velIdeal: "vel. ideal",
    projection: "proyección",
    lastTick: "último tick",
    terminalOutput: "Salida del terminal",
    refreshSentinella: "actualización cada 5s · sesión SENTINELLA",
    noOutput: "sin salida…",
    chartEmpty: "Esperando el primer tick del Centinela…",
    legendProjection: "proyección",
    legendIdeal: "ideal",
    startSending: "Enviando…",
    startQueued: "En cola en el VPS…",
    startStarting: "Iniciando…",
    startSentinel: "Iniciar Centinela",
    startTimeout: "Tiempo agotado: el suscriptor en el VPS no responde.",
    saveError: "Error al guardar",
    networkError: "Error de red",
    unknownError: "error desconocido",
    fetchFailed: "fallo de obtención",
    savedTick: (min) => `Guardado (${min} min). Activo en ~15s.`,
    samplesLine: (n) => `${n} muestras de la sesión actual (últimas 500).`,
  },
  fr: {
    dashboard: "Tableau de bord",
    team: "Équipe",
    sentinel: "Sentinelle",
    subtitle:
      "Surveille la limite de débit et le budget du fournisseur d'IA actif. Tick toutes les 10 min, l'interface se rafraîchit toutes les 30 s.",
    connecting: "connexion…",
    tmuxActive: "session tmux active",
    tmuxInactive: "session tmux inactive",
    openTerminal: "ouvrir le terminal",
    openPowershell: "ouvrir powershell",
    tickInterval: "Intervalle de tick",
    minHint: "min (0.5 = 30s)",
    saving: "Enregistrement…",
    save: "Enregistrer",
    historyLoadError: "Erreur de chargement de l'historique : ",
    loadingHistory: "Chargement de l'historique…",
    velSmoothed: "vél. lissée",
    velIdeal: "vél. idéale",
    projection: "projection",
    lastTick: "dernier tick",
    terminalOutput: "Sortie du terminal",
    refreshSentinella: "actualisation toutes les 5 s · session SENTINELLA",
    noOutput: "aucune sortie…",
    chartEmpty: "En attente du premier tick de la Sentinelle…",
    legendProjection: "projection",
    legendIdeal: "idéal",
    startSending: "Envoi…",
    startQueued: "En file d'attente sur le VPS…",
    startStarting: "Démarrage en cours…",
    startSentinel: "Démarrer la Sentinelle",
    startTimeout: "Délai dépassé : l'abonné sur le VPS ne répond pas.",
    saveError: "Erreur d'enregistrement",
    networkError: "Erreur réseau",
    unknownError: "erreur inconnue",
    fetchFailed: "échec de récupération",
    savedTick: (min) => `Enregistré (${min} min). Actif sous ~15 s.`,
    samplesLine: (n) =>
      `${n} échantillons de la session actuelle (500 derniers).`,
  },
  de: {
    dashboard: "Dashboard",
    team: "Team",
    sentinel: "Wächter",
    subtitle:
      "Überwacht Rate-Limit und Budget des aktiven KI-Anbieters. Tick alle 10 min, UI aktualisiert alle 30 s.",
    connecting: "verbinde…",
    tmuxActive: "tmux-Sitzung aktiv",
    tmuxInactive: "tmux-Sitzung inaktiv",
    openTerminal: "Terminal öffnen",
    openPowershell: "PowerShell öffnen",
    tickInterval: "Tick-Intervall",
    minHint: "min (0.5 = 30s)",
    saving: "Speichere…",
    save: "Speichern",
    historyLoadError: "Fehler beim Laden des Verlaufs: ",
    loadingHistory: "Verlauf wird geladen…",
    velSmoothed: "geglättete Geschw.",
    velIdeal: "ideale Geschw.",
    projection: "Projektion",
    lastTick: "letzter Tick",
    terminalOutput: "Terminal-Ausgabe",
    refreshSentinella: "Aktualisierung alle 5 s · Sitzung SENTINELLA",
    noOutput: "keine Ausgabe…",
    chartEmpty: "Warte auf den ersten Tick des Wächters…",
    legendProjection: "Projektion",
    legendIdeal: "ideal",
    startSending: "Senden…",
    startQueued: "In Warteschlange auf dem VPS…",
    startStarting: "Wird gestartet…",
    startSentinel: "Wächter starten",
    startTimeout:
      "Zeitüberschreitung: Der Subscriber auf dem VPS antwortet nicht.",
    saveError: "Speicherfehler",
    networkError: "Netzwerkfehler",
    unknownError: "unbekannter Fehler",
    fetchFailed: "Abruf fehlgeschlagen",
    savedTick: (min) => `Gespeichert (${min} min). Aktiv in ~15 s.`,
    samplesLine: (n) =>
      `${n} Stichproben aus der aktuellen Sitzung (letzte 500).`,
  },
  hu: {
    dashboard: "Irányítópult",
    team: "Csapat",
    sentinel: "Őrszem",
    subtitle:
      "Az aktív MI-szolgáltató rate-limitjét és büdzséjét figyeli. Tick 10 percenként, a felület 30 mp-enként frissül.",
    connecting: "kapcsolódás…",
    tmuxActive: "tmux munkamenet aktív",
    tmuxInactive: "tmux munkamenet inaktív",
    openTerminal: "terminál megnyitása",
    openPowershell: "powershell megnyitása",
    tickInterval: "Tick intervallum",
    minHint: "min (0.5 = 30s)",
    saving: "Mentés…",
    save: "Mentés",
    historyLoadError: "Hiba az előzmények betöltésekor: ",
    loadingHistory: "Előzmények betöltése…",
    velSmoothed: "simított seb.",
    velIdeal: "ideális seb.",
    projection: "vetítés",
    lastTick: "utolsó tick",
    terminalOutput: "Terminál kimenet",
    refreshSentinella: "frissítés 5 mp-enként · SENTINELLA munkamenet",
    noOutput: "nincs kimenet…",
    chartEmpty: "Várakozás az Őrszem első tickjére…",
    legendProjection: "vetítés",
    legendIdeal: "ideális",
    startSending: "Küldés…",
    startQueued: "Sorban a VPS-en…",
    startStarting: "Indítás folyamatban…",
    startSentinel: "Őrszem indítása",
    startTimeout: "Időtúllépés: a VPS-en lévő feliratkozó nem válaszol.",
    saveError: "Mentési hiba",
    networkError: "Hálózati hiba",
    unknownError: "ismeretlen hiba",
    fetchFailed: "lekérés sikertelen",
    savedTick: (min) => `Mentve (${min} perc). ~15 mp-en belül aktív.`,
    samplesLine: (n) => `${n} minta az aktuális munkamenetből (utolsó 500).`,
  },
  pt: {
    dashboard: "Painel",
    team: "Equipe",
    sentinel: "Sentinela",
    subtitle:
      "Monitora o limite de taxa e o orçamento do provedor de IA ativo. Tick a cada 10 min, a interface atualiza a cada 30 s.",
    connecting: "conectando…",
    tmuxActive: "sessão tmux ativa",
    tmuxInactive: "sessão tmux inativa",
    openTerminal: "abrir terminal",
    openPowershell: "abrir powershell",
    tickInterval: "Intervalo de tick",
    minHint: "min (0.5 = 30s)",
    saving: "Salvando…",
    save: "Salvar",
    historyLoadError: "Erro ao carregar o histórico: ",
    loadingHistory: "Carregando histórico…",
    velSmoothed: "vel. suavizada",
    velIdeal: "vel. ideal",
    projection: "projeção",
    lastTick: "último tick",
    terminalOutput: "Saída do terminal",
    refreshSentinella: "atualização a cada 5s · sessão SENTINELLA",
    noOutput: "sem saída…",
    chartEmpty: "Aguardando o primeiro tick da Sentinela…",
    legendProjection: "projeção",
    legendIdeal: "ideal",
    startSending: "Enviando…",
    startQueued: "Na fila no VPS…",
    startStarting: "Iniciando…",
    startSentinel: "Iniciar Sentinela",
    startTimeout: "Tempo esgotado: o subscriber no VPS não responde.",
    saveError: "Erro ao salvar",
    networkError: "Erro de rede",
    unknownError: "erro desconhecido",
    fetchFailed: "falha ao buscar",
    savedTick: (min) => `Salvo (${min} min). Ativo em ~15s.`,
    samplesLine: (n) => `${n} amostras da sessão atual (últimas 500).`,
  },
};

type Entry = {
  ts: string;
  provider: string;
  usage: number;
  velocity_smooth?: number;
  velocity_ideal?: number;
  projection?: number;
  status:
    | "OK"
    | "ATTENZIONE"
    | "CRITICO"
    | "SOTTOUTILIZZO"
    | "RESET"
    | "ANOMALIA"
    | string;
  throttle?: number;
  reset_at?: string;
  source?: string; // 'bridge' | 'capitano' | 'sentinella-api' | 'sentinella-worker' | 'manual'
};

type OpStatus = { active: boolean; output: string };

const STATUS_COLOR: Record<string, string> = {
  OK: "#4ade80",
  SOTTOUTILIZZO: "#60a5fa",
  ATTENZIONE: "#facc15",
  CRITICO: "#f87171",
  RESET: "#a78bfa",
  ANOMALIA: "#fb923c",
};

// Palette per chi ha generato il sample. Permette di vedere a colpo
// d'occhio chi ha fatto il check (bridge clock automatico, capitano
// post-spawn, sentinella tick, sentinella in fallback worker manuale).
// Architettura nuova 2026-04-25 (D1-D5): tutti gli attori scrivono nel
// JSONL e il grafico distingue.
const SOURCE_COLOR: Record<string, string> = {
  bridge: "#22d3ee", // cyan — orologio automatico
  capitano: "#22c55e", // verde — check on-demand del Capitano
  "sentinella-api": "#a855f7", // viola — Sentinella ramo API
  "sentinella-worker": "#facc15", // giallo — Sentinella fallback TUI manuale
  manual: "#94a3b8", // grigio — debug / inserimento a mano
};

const SOURCE_LABEL: Record<string, string> = {
  bridge: "bridge",
  capitano: "capitano",
  "sentinella-api": "sentinella·api",
  "sentinella-worker": "sentinella·worker",
  manual: "manual",
};

const THROTTLE_LABEL = [
  "T0 full",
  "T1 30s",
  "T2 2 min",
  "T3 5 min",
  "T4 10 min",
];

// ── SVG chart (inline, zero deps) ──────────────────────────────────
function Chart({
  entries,
  localeTag,
  t,
}: {
  entries: Entry[];
  localeTag: string;
  t: Strings;
}) {
  const W = 900;
  const H = 320;
  const PAD = { top: 20, right: 60, bottom: 40, left: 50 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const n = entries.length;
  const xAt = (i: number) => PAD.left + (n <= 1 ? 0.5 : i / (n - 1)) * innerW;
  const yAt = (v: number) =>
    PAD.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;

  const pathFor = (key: keyof Entry) =>
    entries
      .map((e, i) => {
        const v = e[key] as number | undefined;
        if (v === undefined || v === null || Number.isNaN(v)) return null;
        return `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`;
      })
      .filter(Boolean)
      .join(" ");

  const refLines = [50, 80, 95, 100];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: "100%",
        maxWidth: W,
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "#0f172a",
      }}
    >
      {refLines.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yAt(v)}
            y2={yAt(v)}
            stroke={
              v === 100
                ? "#f87171"
                : v === 95
                  ? "#facc15"
                  : "rgba(255,255,255,0.08)"
            }
            strokeDasharray={v >= 95 ? "4 4" : "2 6"}
            strokeWidth={v >= 95 ? 1 : 0.5}
          />
          <text
            x={W - PAD.right + 5}
            y={yAt(v) + 4}
            fontSize={11}
            fill="rgba(255,255,255,0.5)"
          >
            {v}%
          </text>
        </g>
      ))}

      <path
        d={pathFor("projection")}
        stroke="#a78bfa"
        strokeWidth={1.5}
        fill="none"
        strokeDasharray="5 4"
        opacity={0.7}
      />
      <path
        d={pathFor("velocity_ideal")}
        stroke="#64748b"
        strokeWidth={1}
        fill="none"
        opacity={0.5}
      />
      <path
        d={pathFor("usage")}
        stroke="#22d3ee"
        strokeWidth={2.2}
        fill="none"
      />

      {entries.map((e, i) => {
        // Colore in base al source (chi ha fatto il check). Se source
        // mancante (sample vecchi pre-rifattorizzazione 2026-04-25) cade
        // su STATUS_COLOR per backward compat con grafici storici.
        const src = e.source || "";
        const sourceColor = SOURCE_COLOR[src];
        const fill = sourceColor || STATUS_COLOR[e.status] || "#22d3ee";
        // Marker più grande per check fatti da agenti (capitano /
        // sentinella) — sono "eventi" distinti dal cron del bridge.
        const r = src === "capitano" || src.startsWith("sentinella") ? 4 : 3;
        const sourceLabel = SOURCE_LABEL[src] || src || "(legacy)";
        return (
          <circle
            key={i}
            cx={xAt(i)}
            cy={yAt(e.usage)}
            r={r}
            fill={fill}
            stroke="#0f172a"
            strokeWidth={1}
          >
            <title>{`${e.ts} • ${e.usage}% • ${e.status}${e.throttle !== undefined ? " • T" + e.throttle : ""} • ${sourceLabel}`}</title>
          </circle>
        );
      })}

      {entries.length > 0 && (
        <>
          <text
            x={PAD.left}
            y={H - 10}
            fontSize={11}
            fill="rgba(255,255,255,0.5)"
          >
            {new Date(entries[0].ts).toLocaleTimeString(localeTag)}
          </text>
          <text
            x={W - PAD.right}
            y={H - 10}
            fontSize={11}
            fill="rgba(255,255,255,0.5)"
            textAnchor="end"
          >
            {new Date(entries[entries.length - 1].ts).toLocaleTimeString(
              localeTag,
            )}
          </text>
        </>
      )}

      {entries.length === 0 && (
        <text
          x={PAD.left + innerW / 2}
          y={PAD.top + innerH / 2}
          fontSize={13}
          fill="rgba(255,255,255,0.45)"
          textAnchor="middle"
        >
          {t.chartEmpty}
        </text>
      )}

      {/* Linee */}
      <g transform={`translate(${PAD.left}, 10)`}>
        <rect x={0} y={-8} width={14} height={2} fill="#22d3ee" />
        <text x={20} y={-2} fontSize={11} fill="rgba(255,255,255,0.8)">
          usage
        </text>
        <rect x={70} y={-8} width={14} height={2} fill="#a78bfa" />
        <text x={90} y={-2} fontSize={11} fill="rgba(255,255,255,0.8)">
          {t.legendProjection}
        </text>
        <rect x={170} y={-8} width={14} height={2} fill="#64748b" />
        <text x={190} y={-2} fontSize={11} fill="rgba(255,255,255,0.8)">
          {t.legendIdeal}
        </text>
      </g>

      {/* Punti — colorati per source (chi ha fatto il check) */}
      <g transform={`translate(${PAD.left}, 26)`}>
        <circle cx={4} cy={-3} r={3} fill={SOURCE_COLOR.bridge} />
        <text x={14} y={0} fontSize={10} fill="rgba(255,255,255,0.7)">
          bridge
        </text>
        <circle cx={64} cy={-3} r={4} fill={SOURCE_COLOR.capitano} />
        <text x={74} y={0} fontSize={10} fill="rgba(255,255,255,0.7)">
          capitano
        </text>
        <circle cx={138} cy={-3} r={4} fill={SOURCE_COLOR["sentinella-api"]} />
        <text x={148} y={0} fontSize={10} fill="rgba(255,255,255,0.7)">
          sentinella·api
        </text>
        <circle
          cx={236}
          cy={-3}
          r={4}
          fill={SOURCE_COLOR["sentinella-worker"]}
        />
        <text x={246} y={0} fontSize={10} fill="rgba(255,255,255,0.7)">
          sentinella·worker
        </text>
      </g>
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] || "#94a3b8";
  return (
    <span
      style={{
        background: color + "20",
        color,
        border: `1px solid ${color}`,
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          opacity: 0.5,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          marginTop: 2,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────
export default function SentinellaPage() {
  const locale = useLocale();
  const t = T[locale];
  const localeTag = LOCALE_TAG[locale] ?? "en-US";
  const isCloud = useIsCloud();
  // Metriche storiche (grafico + cards)
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Stato operativo tmux (active + output terminale)
  const [op, setOp] = useState<OpStatus | null>(null);
  const startCmd = useTeamCommandPoller();
  const termRef = useRef<HTMLDivElement>(null);

  // Intervallo tick (min) — persistito in jht.config.json via /api/sentinella/config.
  const [tickMin, setTickMin] = useState<number | null>(null);
  const [tickDraft, setTickDraft] = useState<number>(10);
  const [savingTick, setSavingTick] = useState(false);
  const [tickMsg, setTickMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const r = await fetch("/api/sentinella/data", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) {
        setEntries(j.entries || []);
        setErr(null);
      } else {
        setErr(j.error || t.unknownError);
      }
    } catch (e: any) {
      setErr(e?.message || t.fetchFailed);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadOp = useCallback(async () => {
    try {
      const r = await fetch("/api/sentinella/status");
      const j: OpStatus = await r.json();
      setOp(j);
    } catch {
      setOp({ active: false, output: "" });
    }
  }, []);

  const loadTickConfig = useCallback(async () => {
    try {
      const r = await fetch("/api/sentinella/config");
      const j = await r.json();
      if (j?.ok && typeof j.tick_minutes === "number") {
        setTickMin(j.tick_minutes);
        setTickDraft(j.tick_minutes);
      }
    } catch {
      /* ignora, fallback al default */
    }
  }, []);

  useEffect(() => {
    loadData();
    loadOp();
    loadTickConfig();
    if (isCloud) return;
    const dataId = setInterval(loadData, 30_000); // tick ogni 10 min, refresh UI ogni 30s
    const opId = setInterval(loadOp, 5_000); // terminale live
    return () => {
      clearInterval(dataId);
      clearInterval(opId);
    };
  }, [loadData, loadOp, loadTickConfig, isCloud]);

  useEffect(() => {
    if (termRef.current)
      termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [op?.output]);

  // Niente /api/sentinella/start dedicato: usiamo il bus team_commands
  // direttamente. Su cloud → INSERT in team_commands; su local mode il
  // backend non c'è per single-target sentinella, quindi questo path è
  // pensato per VPS.
  const handleStart = () =>
    startCmd.run("/api/team/command", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        payload: { target: "sentinella" },
      }),
    });

  useEffect(() => {
    if (startCmd.state === "done" || startCmd.state === "local") loadOp();
  }, [startCmd.state, loadOp]);

  const startBusy =
    startCmd.state === "posting" ||
    startCmd.state === "pending" ||
    startCmd.state === "running";
  const startLabel =
    startCmd.state === "posting"
      ? t.startSending
      : startCmd.state === "pending"
        ? t.startQueued
        : startCmd.state === "running"
          ? t.startStarting
          : t.startSentinel;
  const startMsg =
    startCmd.error ||
    (startCmd.state === "timeout" ? t.startTimeout : null) ||
    startCmd.message;

  const handleSaveTick = async () => {
    setSavingTick(true);
    setTickMsg(null);
    try {
      const r = await fetch("/api/sentinella/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tick_minutes: tickDraft }),
      });
      const j = await r.json();
      if (j?.ok) {
        setTickMin(j.tick_minutes);
        setTickMsg(t.savedTick(j.tick_minutes));
      } else {
        setTickMsg(j?.error ?? t.saveError);
      }
    } catch {
      setTickMsg(t.networkError);
    } finally {
      setSavingTick(false);
    }
  };

  const last = entries[entries.length - 1];
  const isActive = op?.active ?? false;

  return (
    <div
      style={{
        padding: "24px",
        maxWidth: 1000,
        margin: "0 auto",
        animation: "fade-in 0.35s ease both",
      }}
    >
      {/* Header con breadcrumb */}
      <div className="mb-6 pb-4 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.dashboard}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <Link
            href="/team"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.team}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {t.sentinel}
          </span>
        </nav>

        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="text-3xl leading-none select-none">💂</div>
          <h1
            className="text-2xl font-bold tracking-tight text-[var(--color-white)]"
            style={{ margin: 0 }}
          >
            {t.sentinel}
          </h1>
          {last && <StatusBadge status={last.status} />}
        </div>
        <p
          className="text-[var(--color-muted)] text-[11px] mt-2"
          style={{ margin: "8px 0 0" }}
        >
          {t.subtitle}
        </p>
      </div>

      {/* Stato operativo + Avvia */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-2">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background:
                op == null
                  ? "var(--color-dim)"
                  : isActive
                    ? "#22c55e"
                    : "var(--color-dim)",
              animation: isActive
                ? "pulse-dot 2s ease-in-out infinite"
                : undefined,
            }}
          />
          <span
            className="text-[11px] font-semibold tracking-widest uppercase"
            style={{
              color:
                op == null
                  ? "var(--color-dim)"
                  : isActive
                    ? "#22c55e"
                    : "var(--color-dim)",
            }}
          >
            {op == null
              ? t.connecting
              : isActive
                ? t.tmuxActive
                : t.tmuxInactive}
          </span>
        </div>

        {/* Controlli (start/terminale) — solo desktop, nascosti sul cloud read-only */}
        {isCloud !== true && (
          <>
            {!isActive && (
              <button
                onClick={handleStart}
                disabled={startBusy || op == null}
                className="px-5 py-2 rounded-lg text-[12px] font-bold tracking-wide transition-all"
                style={{
                  background:
                    startBusy || op == null ? "var(--color-border)" : "#607d8b",
                  color: startBusy || op == null ? "var(--color-dim)" : "#fff",
                  cursor: startBusy || op == null ? "not-allowed" : "pointer",
                  opacity: startBusy ? 0.7 : 1,
                }}
              >
                {startLabel}
              </button>
            )}

            {isActive && (
              <button
                onClick={async () => {
                  await fetch("/api/team/terminal/open?session=SENTINELLA", {
                    method: "POST",
                  });
                }}
                className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
              >
                {typeof navigator !== "undefined" &&
                /Mac/.test(navigator.platform)
                  ? t.openTerminal
                  : t.openPowershell}
              </button>
            )}
          </>
        )}

        {startMsg && (
          <span
            className="text-[11px]"
            style={{
              color:
                startCmd.state === "error" || startCmd.state === "timeout"
                  ? "var(--color-red)"
                  : "var(--color-muted)",
            }}
          >
            {startMsg}
          </span>
        )}
      </div>

      {/* Intervallo tick — controllo write (config sentinella): solo desktop, nascosto sul cloud */}
      {isCloud !== true && (
        <div className="mb-6 flex items-center gap-3 flex-wrap bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-3">
          <label
            htmlFor="tick-min"
            className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-dim)]"
          >
            {t.tickInterval}
          </label>
          <input
            id="tick-min"
            type="number"
            min={0.25}
            max={60}
            step={0.25}
            value={tickDraft}
            onChange={(e) =>
              setTickDraft(
                Math.max(0.25, Math.min(60, Number(e.target.value) || 0.25)),
              )
            }
            className="w-20 px-2 py-1 text-[12px] font-mono bg-[var(--color-panel)] border border-[var(--color-border)] rounded text-[var(--color-base)]"
          />
          <span className="text-[11px] text-[var(--color-muted)]">
            {t.minHint}
          </span>
          <button
            onClick={handleSaveTick}
            disabled={savingTick || tickDraft === tickMin}
            className="px-3 py-1 rounded text-[11px] font-semibold tracking-wide transition-all"
            style={{
              background:
                savingTick || tickDraft === tickMin
                  ? "var(--color-border)"
                  : "#607d8b",
              color:
                savingTick || tickDraft === tickMin
                  ? "var(--color-dim)"
                  : "#fff",
              cursor:
                savingTick || tickDraft === tickMin ? "not-allowed" : "pointer",
              opacity: savingTick ? 0.7 : 1,
            }}
          >
            {savingTick ? t.saving : t.save}
          </button>
          {tickMsg && (
            <span className="text-[11px] text-[var(--color-muted)]">
              {tickMsg}
            </span>
          )}
        </div>
      )}

      {/* Errori fetch dati */}
      {err && (
        <div
          style={{
            padding: 12,
            background: "#f8717110",
            color: "#f87171",
            border: "1px solid #f8717150",
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          {t.historyLoadError}
          {err}
        </div>
      )}

      {/* Metric cards */}
      {loading ? (
        <div
          style={{
            padding: 20,
            textAlign: "center",
            opacity: 0.6,
            fontSize: 12,
          }}
        >
          {t.loadingHistory}
        </div>
      ) : last ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <Metric label="provider" value={last.provider} />
          <Metric label="usage" value={`${last.usage}%`} />
          <Metric
            label={t.velSmoothed}
            value={
              last.velocity_smooth !== undefined
                ? `${last.velocity_smooth}%/h`
                : "—"
            }
          />
          <Metric
            label={t.velIdeal}
            value={
              last.velocity_ideal !== undefined
                ? `${last.velocity_ideal}%/h`
                : "—"
            }
          />
          <Metric
            label={t.projection}
            value={last.projection !== undefined ? `${last.projection}%` : "—"}
          />
          <Metric
            label="throttle"
            value={
              last.throttle !== undefined
                ? THROTTLE_LABEL[last.throttle] || "?"
                : "—"
            }
          />
          <Metric label="reset at" value={last.reset_at || "—"} />
          <Metric
            label={t.lastTick}
            value={new Date(last.ts).toLocaleTimeString(localeTag)}
          />
        </div>
      ) : null}

      {/* Grafico — sempre visibile */}
      <Chart entries={entries} localeTag={localeTag} t={t} />

      {entries.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
          {t.samplesLine(entries.length)}
        </div>
      )}

      {/* Terminale live — solo se tmux attiva */}
      {isActive && (
        <div style={{ animation: "fade-in 0.25s ease both", marginTop: 28 }}>
          <div className="flex items-center justify-between mb-2">
            <div className="section-label">{t.terminalOutput}</div>
            <span className="text-[9px] text-[var(--color-dim)] font-mono">
              {t.refreshSentinella}
            </span>
          </div>
          <div
            ref={termRef}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4 font-mono text-[11px] leading-relaxed overflow-auto"
            style={{
              height: "40vh",
              background: "#0d1117",
              color: "var(--color-base)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              borderColor: "#607d8b30",
            }}
          >
            {op?.output ? (
              op.output
            ) : (
              <span style={{ color: "var(--color-dim)" }}>{t.noOutput}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
