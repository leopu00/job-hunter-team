"use client";

// WriterCriticBreakdown — per-Scrittore cost = own + critic spawned.
//
// Mostra il rate aggregato che il Capitano usa per le decisioni di
// throttle (RULE C-11): il Critico (CRITICO-S<N>) è child task atomico
// dello Scrittore N. Il widget visualizza, per ciascuno Scrittore vivo,
// una barra stacked own + critic con i valori numerici a destra.
//
// Sorgente: /api/tokens/status → perWriterAggregated (mappa
// scrittore-N → {own_rate, critic_rate, combined_rate, ...}). Stato
// scritto ogni 30s dal token-meter daemon, qui polliamo ogni 15s.
//
// Empty state: nessuno Scrittore attivo nella finestra (writer-on-demand
// V6, REGOLA C-10): chiarisce che è atteso, non un bug.

import { useEffect, useState } from "react";
import { colorForAgent } from "./agent-colors";
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

const T: Record<string, Record<string, string>> = {
  perWriterCost: {
    it: "Costo per-Scrittore",
    en: "Per-Writer cost",
    hu: "Költség írónként",
    es: "Coste por Escritor",
    de: "Kosten pro Autor",
    fr: "Coût par Rédacteur",
    pt: "Custo por Escritor",
  },
  ownPlusCritic: {
    it: "own + critic spawnato (RULE C-11)",
    en: "own + spawned critic (RULE C-11)",
    hu: "own + indított critic (RULE C-11)",
    es: "own + critic generado (RULE C-11)",
    de: "own + erzeugter critic (RULE C-11)",
    fr: "own + critic généré (RULE C-11)",
    pt: "own + critic gerado (RULE C-11)",
  },
  staleTitle: {
    it: "Dato non aggiornato (>5min)",
    en: "Data not updated (>5min)",
    hu: "Az adat nem frissült (>5perc)",
    es: "Datos no actualizados (>5min)",
    de: "Daten nicht aktualisiert (>5min)",
    fr: "Données non actualisées (>5min)",
    pt: "Dados não atualizados (>5min)",
  },
  lastUpdateTitle: {
    it: "Ultimo update",
    en: "Last update",
    hu: "Utolsó frissítés",
    es: "Última actualización",
    de: "Letztes Update",
    fr: "Dernière mise à jour",
    pt: "Última atualização",
  },
  updatedAt: {
    it: "aggiornato {t}",
    en: "updated {t}",
    hu: "frissítve {t}",
    es: "actualizado {t}",
    de: "aktualisiert {t}",
    fr: "actualisé {t}",
    pt: "atualizado {t}",
  },
  loading: {
    it: "Caricamento…",
    en: "Loading…",
    hu: "Betöltés…",
    es: "Cargando…",
    de: "Wird geladen…",
    fr: "Chargement…",
    pt: "Carregando…",
  },
  emptyState: {
    it: 'Nessuno Scrittore attivo. Atteso in Writer-on-demand V6 — gli Scrittori vengono spawnati dal Capitano solo quando l’utente clicca "Scrivi CV" o invia /cv su Telegram.',
    en: 'No active Writer. Expected in Writer-on-demand V6 — Writers are spawned by the Captain only when the user clicks "Write CV" or sends /cv on Telegram.',
    hu: 'Nincs aktív Író. Ez várható a Writer-on-demand V6-ban — az Írókat a Kapitány csak akkor indítja, amikor a felhasználó a "CV írása" gombra kattint vagy a /cv parancsot küldi Telegramon.',
    es: 'Ningún Escritor activo. Esperado en Writer-on-demand V6 — los Escritores son generados por el Capitán solo cuando el usuario hace clic en "Escribir CV" o envía /cv en Telegram.',
    de: 'Kein aktiver Autor. In Writer-on-demand V6 erwartet — Autoren werden vom Kapitän nur erzeugt, wenn der Nutzer auf "CV schreiben" klickt oder /cv auf Telegram sendet.',
    fr: 'Aucun Rédacteur actif. Attendu en Writer-on-demand V6 — les Rédacteurs sont générés par le Capitaine uniquement quand l’utilisateur clique sur "Écrire CV" ou envoie /cv sur Telegram.',
    pt: 'Nenhum Escritor ativo. Esperado no Writer-on-demand V6 — os Escritores são gerados pelo Capitão apenas quando o usuário clica em "Escrever CV" ou envia /cv no Telegram.',
  },
  orphanTitle: {
    it: "Scrittore parent morto/respawnato, Critico ancora vivo (transiente post-restart)",
    en: "Parent Writer dead/respawned, Critic still alive (transient post-restart)",
    hu: "A szülő Író meghalt/újraindult, a Kritikus még él (átmeneti, újraindítás után)",
    es: "Escritor padre muerto/regenerado, Crítico aún vivo (transitorio tras reinicio)",
    de: "Eltern-Autor tot/neu erzeugt, Kritiker noch aktiv (vorübergehend nach Neustart)",
    fr: "Rédacteur parent mort/régénéré, Critique encore actif (transitoire après redémarrage)",
    pt: "Escritor pai morto/regenerado, Crítico ainda vivo (transitório após reinício)",
  },
  barAria: {
    it: "Scrittore {own} kT/min + Critico {critic} kT/min = {combined} kT/min",
    en: "Writer {own} kT/min + Critic {critic} kT/min = {combined} kT/min",
    hu: "Író {own} kT/min + Kritikus {critic} kT/min = {combined} kT/min",
    es: "Escritor {own} kT/min + Crítico {critic} kT/min = {combined} kT/min",
    de: "Autor {own} kT/min + Kritiker {critic} kT/min = {combined} kT/min",
    fr: "Rédacteur {own} kT/min + Critique {critic} kT/min = {combined} kT/min",
    pt: "Escritor {own} kT/min + Crítico {critic} kT/min = {combined} kT/min",
  },
  ownRateTitle: {
    it: "Scrittore own rate",
    en: "Writer own rate",
    hu: "Író own rate",
    es: "Escritor own rate",
    de: "Autor own rate",
    fr: "Rédacteur own rate",
    pt: "Escritor own rate",
  },
  criticSpawnedTitle: {
    it: "Critico {s} spawnato dallo Scrittore",
    en: "Critic {s} spawned by the Writer",
    hu: "{s} Kritikust az Író indította",
    es: "Crítico {s} generado por el Escritor",
    de: "Kritiker {s} vom Autor erzeugt",
    fr: "Critique {s} généré par le Rédacteur",
    pt: "Crítico {s} gerado pelo Escritor",
  },
  noCriticTitle: {
    it: "Nessun Critico spawnato (review non in flight)",
    en: "No Critic spawned (review not in flight)",
    hu: "Nincs indított Kritikus (a review nincs folyamatban)",
    es: "Ningún Crítico generado (review no en curso)",
    de: "Kein Kritiker erzeugt (Review nicht aktiv)",
    fr: "Aucun Critique généré (review non en cours)",
    pt: "Nenhum Crítico gerado (review não em andamento)",
  },
  combinedRateTitle: {
    it: "Combined rate (own + critic) — usato dal Capitano per throttle",
    en: "Combined rate (own + critic) — used by the Captain for throttle",
    hu: "Combined rate (own + critic) — a Kapitány a throttle-hoz használja",
    es: "Combined rate (own + critic) — usado por el Capitán para el throttle",
    de: "Combined rate (own + critic) — vom Kapitän für Throttle verwendet",
    fr: "Combined rate (own + critic) — utilisé par le Capitaine pour le throttle",
    pt: "Combined rate (own + critic) — usado pelo Capitão para o throttle",
  },
};

type WriterEntry = {
  own_rate_kt_per_min?: number;
  critic_rate_kt_per_min?: number;
  combined_rate_kt_per_min?: number;
  own_weighted_60s?: number;
  critic_weighted_60s?: number;
  combined_weighted_60s?: number;
  critic_session?: string | null;
  writer_session_alive?: boolean;
};

type ApiPayload = {
  running?: boolean;
  stale?: boolean;
  updatedAt?: string;
  perWriterAggregated?: Record<string, WriterEntry>;
};

function formatRate(kt: number): string {
  if (kt < 0.1) return "0";
  if (kt < 1) return kt.toFixed(2);
  if (kt < 100) return kt.toFixed(1);
  return Math.round(kt).toString();
}

export default function WriterCriticBreakdown() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const isCloud = useIsCloud();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/tokens/status", { cache: "no-store" });
        const j: ApiPayload = await r.json();
        if (!cancelled) setData(j);
      } catch {
        /* best-effort, ritenta al prossimo tick */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    // Su CLOUD la sync è on-demand: niente polling continuo (scalerebbe col
    // numero di tab). In locale resta pieno (teatro live del team). Il
    // cancel-guard del load iniziale resta attivo anche su cloud.
    if (isCloud) {
      return () => {
        cancelled = true;
      };
    }
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isCloud]);

  const aggregated = data?.perWriterAggregated ?? {};
  const writers = Object.entries(aggregated)
    .map(([key, entry]) => ({
      key,
      ...entry,
      own: entry.own_rate_kt_per_min ?? 0,
      critic: entry.critic_rate_kt_per_min ?? 0,
      combined: entry.combined_rate_kt_per_min ?? 0,
    }))
    .filter((w) => w.combined > 0 || w.writer_session_alive)
    .sort((a, b) => b.combined - a.combined);

  const maxCombined = writers.reduce((m, w) => Math.max(m, w.combined), 0);

  // Scaling barra: usiamo maxCombined come 100%. Se tutti i writer sono a
  // valori bassi (idle/cooldown), il widget mostra comunque la proporzione
  // relativa fra loro, utile per "chi sta partendo per primo dopo idle".
  // Se vuoto → empty state.

  const updatedAt = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString(
        LOCALE_TAG[locale] ?? "en-US",
        {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        },
      )
    : null;
  const isStale = data?.stale === true;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-dim)]">
            {tr("perWriterCost")}
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">
            {tr("ownPlusCritic")}
          </span>
        </div>
        {updatedAt && (
          <span
            className="text-[10px] text-[var(--color-dim)] tabular-nums"
            title={isStale ? tr("staleTitle") : tr("lastUpdateTitle")}
          >
            {isStale ? "stale · " : ""}
            {tr("updatedAt").replace("{t}", updatedAt)}
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="text-[11px] text-[var(--color-dim)] py-6 text-center">
          {tr("loading")}
        </div>
      ) : writers.length === 0 ? (
        <div
          className="text-[11px] text-[var(--color-dim)] py-3 px-3 rounded"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          {tr("emptyState")}
        </div>
      ) : (
        <div className="space-y-1.5">
          {writers.map((w) => {
            const color = colorForAgent("scrittore");
            const criticColor = colorForAgent("critico");
            const ownPct = maxCombined > 0 ? (w.own / maxCombined) * 100 : 0;
            const criticPct =
              maxCombined > 0 ? (w.critic / maxCombined) * 100 : 0;
            const orphan = w.writer_session_alive === false && w.critic > 0;
            return (
              <div
                key={w.key}
                className="grid grid-cols-[140px_1fr_auto] items-center gap-3 px-2 py-1.5 rounded"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  <span className="text-[11px] text-[var(--color-bright)] font-mono truncate">
                    {w.key}
                  </span>
                  {orphan && (
                    <span
                      className="text-[9px] px-1 py-0.5 rounded font-semibold"
                      style={{
                        color: "var(--color-yellow)",
                        border: "1px solid rgba(255,193,7,0.4)",
                        background: "rgba(255,193,7,0.08)",
                      }}
                      title={tr("orphanTitle")}
                    >
                      orphan
                    </span>
                  )}
                </div>
                <div
                  className="relative h-2 rounded overflow-hidden flex"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                  aria-label={tr("barAria")
                    .replace("{own}", w.own.toFixed(1))
                    .replace("{critic}", w.critic.toFixed(1))
                    .replace("{combined}", w.combined.toFixed(1))}
                >
                  <div
                    style={{
                      width: `${ownPct}%`,
                      background: color,
                      opacity: 0.85,
                    }}
                  />
                  <div
                    style={{
                      width: `${criticPct}%`,
                      background: criticColor,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <div className="flex items-baseline gap-3 text-[10px] font-mono whitespace-nowrap">
                  <span
                    className="tabular-nums"
                    style={{ color }}
                    title={tr("ownRateTitle")}
                  >
                    {formatRate(w.own)}
                  </span>
                  <span className="text-[var(--color-dim)]">+</span>
                  <span
                    className="tabular-nums"
                    style={{ color: criticColor }}
                    title={
                      w.critic_session
                        ? tr("criticSpawnedTitle").replace(
                            "{s}",
                            w.critic_session,
                          )
                        : tr("noCriticTitle")
                    }
                  >
                    {formatRate(w.critic)}
                  </span>
                  <span className="text-[var(--color-dim)]">=</span>
                  <span
                    className="tabular-nums font-semibold text-[var(--color-bright)] w-12 text-right"
                    title={tr("combinedRateTitle")}
                  >
                    {formatRate(w.combined)}
                  </span>
                  <span className="text-[9px] text-[var(--color-dim)]">
                    kT/min
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
