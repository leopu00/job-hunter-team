"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";

type DataSource =
  | "sessions"
  | "tasks"
  | "analytics"
  | "jobs"
  | "applications"
  | "contacts"
  | "companies"
  | "interviews";
type ExportFormat = "json" | "csv";
type SourceGroup = "jobhunting" | "system";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  // group labels
  group_jobhunting: {
    it: "Job Hunting",
    en: "Job Hunting",
    hu: "Álláskeresés",
    es: "Búsqueda de empleo",
    de: "Jobsuche",
    fr: "Recherche d'emploi",
    pt: "Busca de emprego",
  },
  group_system: {
    it: "Sistema",
    en: "System",
    hu: "Rendszer",
    es: "Sistema",
    de: "System",
    fr: "Système",
    pt: "Sistema",
  },
  // source labels
  src_jobs: {
    it: "Offerte",
    en: "Offers",
    hu: "Ajánlatok",
    es: "Ofertas",
    de: "Angebote",
    fr: "Offres",
    pt: "Ofertas",
  },
  src_jobs_desc: {
    it: "Offerte di lavoro salvate",
    en: "Saved job offers",
    hu: "Mentett állásajánlatok",
    es: "Ofertas de empleo guardadas",
    de: "Gespeicherte Stellenangebote",
    fr: "Offres d'emploi enregistrées",
    pt: "Ofertas de emprego salvas",
  },
  src_applications: {
    it: "Candidature",
    en: "Applications",
    hu: "Jelentkezések",
    es: "Candidaturas",
    de: "Bewerbungen",
    fr: "Candidatures",
    pt: "Candidaturas",
  },
  src_applications_desc: {
    it: "Candidature inviate con timeline",
    en: "Submitted applications with timeline",
    hu: "Beküldött jelentkezések idővonallal",
    es: "Candidaturas enviadas con cronología",
    de: "Eingereichte Bewerbungen mit Zeitachse",
    fr: "Candidatures envoyées avec chronologie",
    pt: "Candidaturas enviadas com linha do tempo",
  },
  src_contacts: {
    it: "Contatti",
    en: "Contacts",
    hu: "Kapcsolatok",
    es: "Contactos",
    de: "Kontakte",
    fr: "Contacts",
    pt: "Contatos",
  },
  src_contacts_desc: {
    it: "Contatti networking",
    en: "Networking contacts",
    hu: "Kapcsolatépítési kapcsolatok",
    es: "Contactos de networking",
    de: "Networking-Kontakte",
    fr: "Contacts de réseautage",
    pt: "Contatos de networking",
  },
  src_companies: {
    it: "Aziende",
    en: "Companies",
    hu: "Cégek",
    es: "Empresas",
    de: "Unternehmen",
    fr: "Entreprises",
    pt: "Empresas",
  },
  src_companies_desc: {
    it: "Aziende monitorate con rating",
    en: "Monitored companies with rating",
    hu: "Figyelt cégek értékeléssel",
    es: "Empresas monitoreadas con valoración",
    de: "Überwachte Unternehmen mit Bewertung",
    fr: "Entreprises suivies avec évaluation",
    pt: "Empresas monitoradas com avaliação",
  },
  src_interviews: {
    it: "Colloqui",
    en: "Interviews",
    hu: "Interjúk",
    es: "Entrevistas",
    de: "Vorstellungsgespräche",
    fr: "Entretiens",
    pt: "Entrevistas",
  },
  src_interviews_desc: {
    it: "Colloqui programmati e completati",
    en: "Scheduled and completed interviews",
    hu: "Ütemezett és lezárt interjúk",
    es: "Entrevistas programadas y completadas",
    de: "Geplante und abgeschlossene Gespräche",
    fr: "Entretiens planifiés et terminés",
    pt: "Entrevistas agendadas e concluídas",
  },
  src_sessions: {
    it: "Sessioni",
    en: "Sessions",
    hu: "Munkamenetek",
    es: "Sesiones",
    de: "Sitzungen",
    fr: "Sessions",
    pt: "Sessões",
  },
  src_sessions_desc: {
    it: "Sessioni agente con stato e metadata",
    en: "Agent sessions with status and metadata",
    hu: "Ügynök munkamenetek állapottal és metaadatokkal",
    es: "Sesiones de agente con estado y metadatos",
    de: "Agentensitzungen mit Status und Metadaten",
    fr: "Sessions d'agent avec statut et métadonnées",
    pt: "Sessões de agente com estado e metadados",
  },
  src_tasks: {
    it: "Task",
    en: "Tasks",
    hu: "Feladatok",
    es: "Tareas",
    de: "Aufgaben",
    fr: "Tâches",
    pt: "Tarefas",
  },
  src_tasks_desc: {
    it: "Task con status, tempi e agente",
    en: "Tasks with status, timing and agent",
    hu: "Feladatok állapottal, időkkel és ügynökkel",
    es: "Tareas con estado, tiempos y agente",
    de: "Aufgaben mit Status, Zeiten und Agent",
    fr: "Tâches avec statut, durées et agent",
    pt: "Tarefas com estado, tempos e agente",
  },
  src_analytics: {
    it: "Analytics",
    en: "Analytics",
    hu: "Analitika",
    es: "Analytics",
    de: "Analytics",
    fr: "Analytics",
    pt: "Analytics",
  },
  src_analytics_desc: {
    it: "Chiamate API, token, costi, latenza",
    en: "API calls, tokens, costs, latency",
    hu: "API-hívások, tokenek, költségek, késleltetés",
    es: "Llamadas API, tokens, costes, latencia",
    de: "API-Aufrufe, Tokens, Kosten, Latenz",
    fr: "Appels API, tokens, coûts, latence",
    pt: "Chamadas API, tokens, custos, latência",
  },
  // UI
  title: {
    it: "Esporta Dati",
    en: "Export Data",
    hu: "Adatok exportálása",
    es: "Exportar datos",
    de: "Daten exportieren",
    fr: "Exporter les données",
    pt: "Exportar dados",
  },
  breadcrumb: {
    it: "Esporta",
    en: "Export",
    hu: "Exportálás",
    es: "Exportar",
    de: "Exportieren",
    fr: "Exporter",
    pt: "Exportar",
  },
  subtitle: {
    it: "Esporta dati job hunting e sistema in JSON o CSV",
    en: "Export job hunting and system data to JSON or CSV",
    hu: "Álláskeresési és rendszeradatok exportálása JSON vagy CSV formátumba",
    es: "Exporta datos de búsqueda de empleo y sistema en JSON o CSV",
    de: "Jobsuche- und Systemdaten als JSON oder CSV exportieren",
    fr: "Exportez les données de recherche d'emploi et système en JSON ou CSV",
    pt: "Exporte dados de busca de emprego e do sistema em JSON ou CSV",
  },
  label_source: {
    it: "Sorgente dati",
    en: "Data source",
    hu: "Adatforrás",
    es: "Fuente de datos",
    de: "Datenquelle",
    fr: "Source de données",
    pt: "Fonte de dados",
  },
  label_format: {
    it: "Formato",
    en: "Format",
    hu: "Formátum",
    es: "Formato",
    de: "Format",
    fr: "Format",
    pt: "Formato",
  },
  label_period: {
    it: "Periodo",
    en: "Period",
    hu: "Időszak",
    es: "Período",
    de: "Zeitraum",
    fr: "Période",
    pt: "Período",
  },
  aria_from: {
    it: "Data inizio",
    en: "Start date",
    hu: "Kezdő dátum",
    es: "Fecha de inicio",
    de: "Startdatum",
    fr: "Date de début",
    pt: "Data de início",
  },
  aria_to: {
    it: "Data fine",
    en: "End date",
    hu: "Záró dátum",
    es: "Fecha de fin",
    de: "Enddatum",
    fr: "Date de fin",
    pt: "Data de fim",
  },
  range_all: {
    it: "Tutto",
    en: "All",
    hu: "Mind",
    es: "Todo",
    de: "Alle",
    fr: "Tout",
    pt: "Tudo",
  },
  summary: {
    it: "Riepilogo export",
    en: "Export summary",
    hu: "Exportálás összegzése",
    es: "Resumen de exportación",
    de: "Export-Zusammenfassung",
    fr: "Récapitulatif de l'export",
    pt: "Resumo da exportação",
  },
  row_source: {
    it: "Sorgente",
    en: "Source",
    hu: "Forrás",
    es: "Fuente",
    de: "Quelle",
    fr: "Source",
    pt: "Fonte",
  },
  row_format: {
    it: "Formato",
    en: "Format",
    hu: "Formátum",
    es: "Formato",
    de: "Format",
    fr: "Format",
    pt: "Formato",
  },
  row_period: {
    it: "Periodo",
    en: "Period",
    hu: "Időszak",
    es: "Período",
    de: "Zeitraum",
    fr: "Période",
    pt: "Período",
  },
  btn_export: {
    it: "Esporta",
    en: "Export",
    hu: "Exportálás",
    es: "Exportar",
    de: "Exportieren",
    fr: "Exporter",
    pt: "Exportar",
  },
  btn_exporting: {
    it: "Esportazione…",
    en: "Exporting…",
    hu: "Exportálás…",
    es: "Exportando…",
    de: "Wird exportiert…",
    fr: "Exportation…",
    pt: "Exportando…",
  },
  downloaded: {
    it: "{file} scaricato",
    en: "{file} downloaded",
    hu: "{file} letöltve",
    es: "{file} descargado",
    de: "{file} heruntergeladen",
    fr: "{file} téléchargé",
    pt: "{file} baixado",
  },
  err_unknown: {
    it: "Errore sconosciuto",
    en: "Unknown error",
    hu: "Ismeretlen hiba",
    es: "Error desconocido",
    de: "Unbekannter Fehler",
    fr: "Erreur inconnue",
    pt: "Erro desconhecido",
  },
  err_generic: {
    it: "Errore",
    en: "Error",
    hu: "Hiba",
    es: "Error",
    de: "Fehler",
    fr: "Erreur",
    pt: "Erro",
  },
  err_network: {
    it: "Errore di rete",
    en: "Network error",
    hu: "Hálózati hiba",
    es: "Error de red",
    de: "Netzwerkfehler",
    fr: "Erreur réseau",
    pt: "Erro de rede",
  },
};

const SOURCES: {
  id: DataSource;
  labelKey: string;
  descKey: string;
  color: string;
  group: SourceGroup;
}[] = [
  {
    id: "jobs",
    labelKey: "src_jobs",
    descKey: "src_jobs_desc",
    color: "#61affe",
    group: "jobhunting",
  },
  {
    id: "applications",
    labelKey: "src_applications",
    descKey: "src_applications_desc",
    color: "var(--color-green)",
    group: "jobhunting",
  },
  {
    id: "contacts",
    labelKey: "src_contacts",
    descKey: "src_contacts_desc",
    color: "#9b59b6",
    group: "jobhunting",
  },
  {
    id: "companies",
    labelKey: "src_companies",
    descKey: "src_companies_desc",
    color: "#fca130",
    group: "jobhunting",
  },
  {
    id: "interviews",
    labelKey: "src_interviews",
    descKey: "src_interviews_desc",
    color: "#50e3c2",
    group: "jobhunting",
  },
  {
    id: "sessions",
    labelKey: "src_sessions",
    descKey: "src_sessions_desc",
    color: "var(--color-green)",
    group: "system",
  },
  {
    id: "tasks",
    labelKey: "src_tasks",
    descKey: "src_tasks_desc",
    color: "var(--color-blue)",
    group: "system",
  },
  {
    id: "analytics",
    labelKey: "src_analytics",
    descKey: "src_analytics_desc",
    color: "var(--color-yellow)",
    group: "system",
  },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export default function ExportPage() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [source, setSource] = useState<DataSource>("tasks");
  const [format, setFormat] = useState<ExportFormat>("json");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );

  const doExport = useCallback(async () => {
    setExporting(true);
    setResult(null);
    try {
      const url = `/api/export?source=${source}&format=${format}&from=${from}&to=${to}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: tr("err_unknown") }));
        setResult({ ok: false, msg: err.error ?? tr("err_generic") });
        return;
      }
      const blob = await res.blob();
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ??
        `export.${format}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setResult({
        ok: true,
        msg: tr("downloaded").replace("{file}", filename),
      });
    } catch {
      setResult({ ok: false, msg: tr("err_network") });
    } finally {
      setExporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, format, from, to, locale]);

  const activeSrc = SOURCES.find((s) => s.id === source)!;

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
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
            {tr("breadcrumb")}
          </span>
        </nav>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-white)]">
          {tr("title")}
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {tr("subtitle")}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Colonna sinistra — selezione */}
        <div className="space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">
              {tr("label_source")}
            </p>
            <div className="space-y-3">
              {(["jobhunting", "system"] as SourceGroup[]).map((group) => (
                <div key={group}>
                  <p className="text-[8px] font-bold tracking-widest text-[var(--color-dim)] mb-1">
                    {tr(
                      group === "jobhunting"
                        ? "group_jobhunting"
                        : "group_system",
                    ).toUpperCase()}
                  </p>
                  <div className="space-y-1">
                    {SOURCES.filter((s) => s.group === group).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSource(s.id)}
                        className="w-full text-left px-3 py-2 rounded-lg transition-all cursor-pointer"
                        style={{
                          border: `1px solid ${source === s.id ? s.color : "var(--color-border)"}`,
                          background:
                            source === s.id ? `${s.color}0d` : "transparent",
                        }}
                      >
                        <p
                          className="text-[11px] font-semibold"
                          style={{
                            color:
                              source === s.id ? s.color : "var(--color-muted)",
                          }}
                        >
                          {tr(s.labelKey)}
                        </p>
                        <p className="text-[8px] text-[var(--color-dim)]">
                          {tr(s.descKey)}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">
              {tr("label_format")}
            </p>
            <div className="flex gap-2">
              {(["json", "csv"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className="flex-1 px-3 py-2 rounded text-[11px] font-semibold uppercase cursor-pointer transition-all"
                  style={{
                    border: `1px solid ${format === f ? "var(--color-green)" : "var(--color-border)"}`,
                    color:
                      format === f ? "var(--color-green)" : "var(--color-dim)",
                    background:
                      format === f ? "rgba(0,232,122,0.08)" : "transparent",
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">
              {tr("label_period")}
            </p>
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label={tr("aria_from")}
                className="flex-1 text-[11px] px-3 py-2 rounded border bg-transparent font-mono"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-muted)",
                }}
              />
              <span
                className="text-[9px] text-[var(--color-dim)]"
                aria-hidden="true"
              >
                →
              </span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label={tr("aria_to")}
                className="flex-1 text-[11px] px-3 py-2 rounded border bg-transparent font-mono"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-muted)",
                }}
              />
            </div>
            <div className="flex gap-1 mt-2">
              {[
                { l: "7g", d: 7 },
                { l: "30g", d: 30 },
                { l: "90g", d: 90 },
                { l: tr("range_all"), d: 3650 },
              ].map((p) => (
                <button
                  key={p.l}
                  onClick={() => {
                    setFrom(daysAgo(p.d));
                    setTo(today());
                  }}
                  className="px-2 py-1 rounded text-[9px] cursor-pointer transition-colors"
                  style={{
                    border: "1px solid var(--color-border)",
                    color: "var(--color-dim)",
                    background: "transparent",
                  }}
                >
                  {p.l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Colonna destra — anteprima e azione */}
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">
              {tr("summary")}
            </p>
            <div className="space-y-2">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-dim)]">
                  {tr("row_source")}
                </span>
                <span
                  className="font-semibold"
                  style={{ color: activeSrc.color }}
                >
                  {tr(activeSrc.labelKey)}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-dim)]">
                  {tr("row_format")}
                </span>
                <span className="text-[var(--color-muted)] font-mono uppercase">
                  {format}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-dim)]">
                  {tr("row_period")}
                </span>
                <span className="text-[var(--color-muted)] font-mono">
                  {from} → {to}
                </span>
              </div>
            </div>
            <button
              onClick={doExport}
              disabled={exporting}
              className="w-full mt-5 px-4 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all"
              style={{
                background: exporting
                  ? "var(--color-border)"
                  : "var(--color-green)",
                color: exporting ? "var(--color-dim)" : "#000",
                border: "none",
              }}
            >
              {exporting ? tr("btn_exporting") : tr("btn_export")}
            </button>
          </div>

          {result && (
            <div
              role="alert"
              className="rounded-lg border p-3 text-[11px]"
              style={{
                borderColor: result.ok
                  ? "rgba(0,232,122,0.3)"
                  : "rgba(255,69,96,0.3)",
                color: result.ok ? "var(--color-green)" : "var(--color-red)",
                background: result.ok
                  ? "rgba(0,232,122,0.05)"
                  : "rgba(255,69,96,0.05)",
              }}
            >
              {result.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
