import Link from "next/link";
import { cookies } from "next/headers";
import { getScoutStats } from "@/lib/queries";
import ScoutLiveSection from "./_components/ScoutLiveSection";
import AgentInteraction from "@/components/AgentInteraction";
import { locales, defaultLocale, type Locale } from "@/i18n/config";

const T: Record<string, Record<Locale, string>> = {
  dashboard: {
    it: "Dashboard",
    en: "Dashboard",
    es: "Panel",
    fr: "Tableau de bord",
    de: "Dashboard",
    hu: "Irányítópult",
    pt: "Painel",
  },
  team: {
    it: "Team",
    en: "Team",
    es: "Equipo",
    fr: "Équipe",
    de: "Team",
    hu: "Csapat",
    pt: "Equipe",
  },
  scout: {
    it: "Scout",
    en: "Scout",
    es: "Explorador",
    fr: "Éclaireur",
    de: "Späher",
    hu: "Felderítő",
    pt: "Explorador",
  },
  scoutSubtitle: {
    it: "Posizioni trovate per agente · {total} totali",
    en: "Positions found per agent · {total} total",
    es: "Posiciones encontradas por agente · {total} totales",
    fr: "Postes trouvés par agent · {total} au total",
    de: "Gefundene Positionen pro Agent · {total} insgesamt",
    hu: "Talált pozíciók ügynökönként · {total} összesen",
    pt: "Vagas encontradas por agente · {total} no total",
  },
  totalPositions: {
    it: "Posizioni totali",
    en: "Total positions",
    es: "Posiciones totales",
    fr: "Postes au total",
    de: "Positionen gesamt",
    hu: "Összes pozíció",
    pt: "Vagas no total",
  },
  activeScouts: {
    it: "Scout attivi",
    en: "Active Scouts",
    es: "Exploradores activos",
    fr: "Éclaireurs actifs",
    de: "Aktive Späher",
    hu: "Aktív Felderítők",
    pt: "Exploradores ativos",
  },
  sent: {
    it: "Inviate",
    en: "Sent",
    es: "Enviadas",
    fr: "Envoyées",
    de: "Gesendet",
    hu: "Elküldve",
    pt: "Enviadas",
  },
  responses: {
    it: "Risposte",
    en: "Responses",
    es: "Respuestas",
    fr: "Réponses",
    de: "Antworten",
    hu: "Válaszok",
    pt: "Respostas",
  },
  activityPerScout: {
    it: "Attività per Scout",
    en: "Activity per Scout",
    es: "Actividad por Explorador",
    fr: "Activité par Éclaireur",
    de: "Aktivität pro Späher",
    hu: "Tevékenység Felderítőnként",
    pt: "Atividade por Explorador",
  },
  noActivity: {
    it: "Nessuna attività registrata.",
    en: "No activity recorded.",
    es: "Ninguna actividad registrada.",
    fr: "Aucune activité enregistrée.",
    de: "Keine Aktivität erfasst.",
    hu: "Nincs rögzített tevékenység.",
    pt: "Nenhuma atividade registrada.",
  },
  positionsLc: {
    it: "posizioni",
    en: "positions",
    es: "posiciones",
    fr: "postes",
    de: "Positionen",
    hu: "pozíció",
    pt: "vagas",
  },
  sentRespLine: {
    it: "{sent}% inviate · {resp}% risposta",
    en: "{sent}% sent · {resp}% response",
    es: "{sent}% enviadas · {resp}% respuesta",
    fr: "{sent}% envoyées · {resp}% réponse",
    de: "{sent}% gesendet · {resp}% Antwort",
    hu: "{sent}% elküldve · {resp}% válasz",
    pt: "{sent}% enviadas · {resp}% resposta",
  },
  totalLabel: {
    it: "Totale",
    en: "Total",
    es: "Total",
    fr: "Total",
    de: "Gesamt",
    hu: "Összes",
    pt: "Total",
  },
  activeLabel: {
    it: "Attive",
    en: "Active",
    es: "Activas",
    fr: "Actives",
    de: "Aktiv",
    hu: "Aktív",
    pt: "Ativas",
  },
  excludedLabel: {
    it: "Escluse",
    en: "Excluded",
    es: "Excluidas",
    fr: "Exclues",
    de: "Ausgeschlossen",
    hu: "Kizárva",
    pt: "Excluídas",
  },
  sentLabel: {
    it: "Inviate",
    en: "Sent",
    es: "Enviadas",
    fr: "Envoyées",
    de: "Gesendet",
    hu: "Elküldve",
    pt: "Enviadas",
  },
  sentBar: {
    it: "inviate",
    en: "sent",
    es: "enviadas",
    fr: "envoyées",
    de: "gesendet",
    hu: "elküldve",
    pt: "enviadas",
  },
};

export default async function ScoutPage() {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale =
    cookieLocale && (locales as string[]).includes(cookieLocale)
      ? (cookieLocale as Locale)
      : defaultLocale;
  const t = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  const stats = await getScoutStats();
  const total = stats.reduce((a, s) => a + s.total, 0);

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t("dashboard")}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <Link
            href="/team"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t("team")}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {t("scout")}
          </span>
        </nav>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            {t("scout")}
          </h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            {t("scoutSubtitle").replace("{total}", String(total))}
          </p>
        </div>
      </div>

      {/* ── Totale KPI ───────────────────────────────────────────── */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10"
        style={{ animation: "fade-in 0.35s ease both" }}
      >
        {[
          {
            label: t("totalPositions"),
            val: total,
            color: "var(--color-blue)",
          },
          {
            label: t("activeScouts"),
            val: stats.length,
            color: "var(--color-purple)",
          },
          {
            label: t("sent"),
            val: stats.reduce((a, s) => a + s.applied, 0),
            color: "var(--color-green)",
          },
          {
            label: t("responses"),
            val: stats.reduce((a, s) => a + s.responded, 0),
            color: "#58a6ff",
          },
        ].map(({ label, val, color }, i) => (
          <div
            key={label}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
            style={{ animation: `fade-in 0.4s ease ${i * 0.06}s both` }}
          >
            <div
              className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2"
              style={{ color: "var(--color-dim)" }}
            >
              {label}
            </div>
            <div
              className="text-3xl font-bold tracking-tight leading-none"
              style={{ color }}
            >
              {val}
            </div>
          </div>
        ))}
      </div>

      {/* ── Per agente ───────────────────────────────────────────── */}
      <div
        className="section-label mb-4"
        style={{ animation: "fade-in 0.35s ease 0.05s both" }}
      >
        {t("activityPerScout")}
      </div>
      {stats.length === 0 ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-8 text-center text-[var(--color-dim)] text-[11px]">
          {t("noActivity")}
        </div>
      ) : (
        <div className="space-y-4">
          {stats.map((s, i) => {
            const colors = [
              "var(--color-blue)",
              "var(--color-purple)",
              "var(--color-green)",
              "var(--color-yellow)",
            ];
            const color = colors[i % colors.length];
            const pctApplied =
              s.total > 0 ? ((s.applied / s.total) * 100).toFixed(1) : "0";
            const pctResponded =
              s.applied > 0
                ? ((s.responded / s.applied) * 100).toFixed(1)
                : "0";
            return (
              <div
                key={s.scout}
                className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors"
                style={{ animation: `fade-in 0.4s ease ${i * 0.08}s both` }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-[13px] font-bold" style={{ color }}>
                      {s.scout}
                    </span>
                    <span className="text-[10px] text-[var(--color-dim)] ml-2">
                      {s.total} {t("positionsLc")}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--color-dim)]">
                    {t("sentRespLine")
                      .replace("{sent}", pctApplied)
                      .replace("{resp}", pctResponded)}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: t("totalLabel"), val: s.total, c: color },
                    {
                      label: t("activeLabel"),
                      val: s.active,
                      c: "var(--color-muted)",
                    },
                    {
                      label: t("excludedLabel"),
                      val: s.excluded,
                      c: "var(--color-red)",
                    },
                    {
                      label: t("sentLabel"),
                      val: s.applied,
                      c: "var(--color-green)",
                    },
                  ].map(({ label, val, c }) => (
                    <div key={label} className="text-center">
                      <div
                        className="text-[9px] font-semibold tracking-widest uppercase mb-1"
                        style={{ color: "var(--color-dim)" }}
                      >
                        {label}
                      </div>
                      <div className="text-2xl font-bold" style={{ color: c }}>
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Bar: inviate */}
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[var(--color-dim)] w-14 text-right shrink-0">
                    {t("sentBar")}
                  </span>
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: "var(--color-border)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pctApplied}%`,
                        background: color,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <span
                    className="text-[10px] font-semibold w-10 shrink-0"
                    style={{ color }}
                  >
                    {pctApplied}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ScoutLiveSection />

      <AgentInteraction
        sessionPrefix="SCOUT"
        color="#2196f3"
        label={t("scout")}
      />
    </div>
  );
}
