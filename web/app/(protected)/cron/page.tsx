"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { CronJob, CronListResponse } from "./types";
import { CronJobRow } from "./CronJobRow";
import { CronForm } from "./CronForm";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  err_load: {
    it: "Errore caricamento",
    en: "Loading error",
    hu: "Betöltési hiba",
    es: "Error de carga",
    de: "Ladefehler",
    fr: "Erreur de chargement",
    pt: "Erro de carregamento",
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
  subtitle: {
    it: "{a} attivi · {p} in pausa",
    en: "{a} active · {p} paused",
    hu: "{a} aktív · {p} szüneteltetve",
    es: "{a} activos · {p} en pausa",
    de: "{a} aktiv · {p} pausiert",
    fr: "{a} actifs · {p} en pause",
    pt: "{a} ativos · {p} em pausa",
  },
  cancel: {
    it: "Annulla",
    en: "Cancel",
    hu: "Mégse",
    es: "Cancelar",
    de: "Abbrechen",
    fr: "Annuler",
    pt: "Cancelar",
  },
  new_job: {
    it: "+ Nuovo job",
    en: "+ New job",
    hu: "+ Új feladat",
    es: "+ Nueva tarea",
    de: "+ Neuer Job",
    fr: "+ Nouvelle tâche",
    pt: "+ Nova tarefa",
  },
  new_job_title: {
    it: "Nuovo job",
    en: "New job",
    hu: "Új feladat",
    es: "Nueva tarea",
    de: "Neuer Job",
    fr: "Nouvelle tâche",
    pt: "Nova tarefa",
  },
  active_jobs: {
    it: "Job attivi",
    en: "Active jobs",
    hu: "Aktív feladatok",
    es: "Tareas activas",
    de: "Aktive Jobs",
    fr: "Tâches actives",
    pt: "Tarefas ativas",
  },
  refresh_8s: {
    it: "aggiornamento ogni 8s",
    en: "refresh every 8s",
    hu: "frissítés 8 mp-enként",
    es: "actualización cada 8s",
    de: "Aktualisierung alle 8 Sek.",
    fr: "actualisation toutes les 8s",
    pt: "atualização a cada 8s",
  },
  empty: {
    it: "Nessun job configurato.",
    en: "No jobs configured.",
    hu: "Nincs konfigurált feladat.",
    es: "Ninguna tarea configurada.",
    de: "Keine Jobs konfiguriert.",
    fr: "Aucune tâche configurée.",
    pt: "Nenhuma tarefa configurada.",
  },
  empty_hint: {
    it: 'Usa "+ Nuovo job" per crearne uno.',
    en: 'Use "+ New job" to create one.',
    hu: 'Használd a "+ Új feladat" gombot egy létrehozásához.',
    es: 'Usa "+ Nueva tarea" para crear una.',
    de: 'Nutze "+ Neuer Job", um einen zu erstellen.',
    fr: 'Utilisez "+ Nouvelle tâche" pour en créer une.',
    pt: 'Use "+ Nova tarefa" para criar uma.',
  },
};

export default function CronPage() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cron");
      const data = (await res.json()) as CronListResponse;
      setJobs(data.jobs ?? []);
    } catch {
      setError(T.err_load[locale] ?? T.err_load.en);
    }
    setLoading(false);
  }, [locale]);

  useEffect(() => {
    load();
  }, [load]);
  // Polling ogni 8s
  useEffect(() => {
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [load]);

  const handleToggle = async (id: string, enabled: boolean) => {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, enabled } : j)));
    try {
      await fetch(`/api/cron/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      load();
    } catch {
      load();
    }
  };

  const handleDelete = async (id: string) => {
    setJobs((js) => js.filter((j) => j.id !== id));
    try {
      await fetch(`/api/cron/${id}`, { method: "DELETE" });
    } catch {
      load();
    }
  };

  const active = jobs.filter((j) => j.enabled).length;
  const inactive = jobs.filter((j) => !j.enabled).length;

  return (
    <main
      className="min-h-screen px-5 py-8"
      style={{ position: "relative", zIndex: 1 }}
    >
      <div
        className="max-w-2xl mx-auto"
        style={{ animation: "fade-in 0.4s ease both" }}
      >
        {/* Header */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            Cron Jobs
          </span>
        </nav>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1
              className="text-xl font-bold tracking-tight"
              style={{ color: "var(--color-white)" }}
            >
              Cron Jobs
            </h1>
            <p
              className="text-[11px] mt-0.5"
              style={{ color: "var(--color-muted)" }}
            >
              {loading
                ? tr("loading")
                : tr("subtitle")
                    .replace("{a}", String(active))
                    .replace("{p}", String(inactive))}
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="px-4 py-2 rounded text-[12px] font-bold cursor-pointer transition-all"
            style={
              showForm
                ? {
                    background: "var(--color-card)",
                    color: "var(--color-muted)",
                    border: "1px solid var(--color-border)",
                  }
                : { background: "var(--color-green)", color: "#000" }
            }
          >
            {showForm ? tr("cancel") : tr("new_job")}
          </button>
        </div>

        {error && (
          <div
            className="mb-4 px-4 py-3 rounded border text-[11px]"
            style={{
              borderColor: "var(--color-red)",
              color: "var(--color-red)",
              background: "rgba(255,69,96,0.06)",
            }}
          >
            {error}
          </div>
        )}

        {/* Form nuovo job */}
        {showForm && (
          <div
            className="mb-6 border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden"
            style={{ animation: "fade-in 0.2s ease both" }}
          >
            <div className="px-6 py-4 border-b border-[var(--color-border)]">
              <p
                className="text-[11px] font-bold tracking-widest uppercase"
                style={{ color: "var(--color-bright)" }}
              >
                {tr("new_job_title")}
              </p>
            </div>
            <CronForm
              onCreated={() => {
                setShowForm(false);
                load();
              }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}

        {/* Lista job */}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <p
              className="text-[11px] font-bold tracking-widest uppercase"
              style={{ color: "var(--color-bright)" }}
            >
              {tr("active_jobs")}
            </p>
            <p className="text-[10px]" style={{ color: "var(--color-dim)" }}>
              {tr("refresh_8s")}
            </p>
          </div>
          {loading ? (
            <div
              className="px-6 py-8 text-center text-[11px]"
              style={{ color: "var(--color-dim)" }}
              role="status"
              aria-live="polite"
            >
              {tr("loading")}
            </div>
          ) : jobs.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p
                className="text-[12px]"
                style={{ color: "var(--color-muted)" }}
              >
                {tr("empty")}
              </p>
              <p
                className="text-[10px] mt-1"
                style={{ color: "var(--color-dim)" }}
              >
                {tr("empty_hint")}
              </p>
            </div>
          ) : (
            jobs.map((job) => (
              <CronJobRow
                key={job.id}
                job={job}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>

        <p
          className="mt-6 text-center text-[9px]"
          style={{ color: "var(--color-dim)" }}
        >
          v0.1.0-alpha · Job Hunter Team
        </p>
      </div>
    </main>
  );
}
