"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

type Texts = {
  breadcrumb: string;
  title: string;
  subtitle: string;
  notConfigurable: string;
  notConfigurableBody: string;
  loading: string;
  refresh: string;
  missing: string;
  fresh: (min: number) => string;
  stale: (min: number) => string;
  provider: string;
  window5h: string;
  windowWeek: string;
  total: string;
  unattributed: string;
  role: string;
  share: string;
  agents: string;
  noRoles: string;
  hourTitle: string;
  hourNone: string;
};

const T: Record<Locale, Texts> = {
  it: {
    breadcrumb: "Consumo",
    title: "Consumo del provider",
    subtitle: "Quanto ha consumato la squadra, come lo misura la sentinella",
    notConfigurable: "Qui non si impostano limiti",
    notConfigurableBody:
      "Questa pagina è in sola lettura. I limiti di richieste non sono configurabili: il consumo che frena la squadra è quello che la sentinella legge dal provider.",
    loading: "Caricamento…",
    refresh: "aggiorna",
    missing:
      "La sentinella non ha ancora scritto il consumo: non so quanto abbia consumato la squadra.",
    fresh: (min) => `letto ${min} min fa`,
    stale: (min) =>
      `dato vecchio di ${min} min: non è più il consumo di adesso`,
    provider: "Provider",
    window5h: "Finestra di 5 ore",
    windowWeek: "Settimana del provider",
    total: "Totale",
    unattributed: "Non attribuito",
    role: "Ruolo",
    share: "Quota",
    agents: "Agenti",
    noRoles: "Nessun consumo in questa finestra.",
    hourTitle: "Ultima ora per agente",
    hourNone: "Nessun agente con log leggibili nell'ultima ora.",
  },
  en: {
    breadcrumb: "Usage",
    title: "Provider usage",
    subtitle: "What the team has used, as the sentinel measures it",
    notConfigurable: "No limits are set here",
    notConfigurableBody:
      "This page is read-only. Request limits are not configurable: the usage that slows the team down is what the sentinel reads from the provider.",
    loading: "Loading…",
    refresh: "refresh",
    missing:
      "The sentinel has not written the usage yet: it is not known how much the team has used.",
    fresh: (min) => `read ${min} min ago`,
    stale: (min) => `data is ${min} min old: it is not the current usage`,
    provider: "Provider",
    window5h: "5-hour window",
    windowWeek: "Provider week",
    total: "Total",
    unattributed: "Unattributed",
    role: "Role",
    share: "Share",
    agents: "Agents",
    noRoles: "No usage in this window.",
    hourTitle: "Last hour by agent",
    hourNone: "No agent with readable logs in the last hour.",
  },
  es: {
    breadcrumb: "Consumo",
    title: "Consumo del proveedor",
    subtitle: "Lo que ha consumido el equipo, como lo mide el centinela",
    notConfigurable: "Aquí no se fijan límites",
    notConfigurableBody:
      "Esta página es de solo lectura. Los límites de peticiones no se pueden configurar: el consumo que frena al equipo es el que el centinela lee del proveedor.",
    loading: "Cargando…",
    refresh: "actualizar",
    missing:
      "El centinela aún no ha escrito el consumo: no se sabe cuánto ha consumido el equipo.",
    fresh: (min) => `leído hace ${min} min`,
    stale: (min) => `dato de hace ${min} min: ya no es el consumo actual`,
    provider: "Proveedor",
    window5h: "Ventana de 5 horas",
    windowWeek: "Semana del proveedor",
    total: "Total",
    unattributed: "Sin atribuir",
    role: "Rol",
    share: "Cuota",
    agents: "Agentes",
    noRoles: "Sin consumo en esta ventana.",
    hourTitle: "Última hora por agente",
    hourNone: "Ningún agente con registros legibles en la última hora.",
  },
  fr: {
    breadcrumb: "Consommation",
    title: "Consommation du fournisseur",
    subtitle: "Ce que l'équipe a consommé, tel que la sentinelle le mesure",
    notConfigurable: "Aucune limite ne se règle ici",
    notConfigurableBody:
      "Cette page est en lecture seule. Les limites de requêtes ne sont pas configurables : la consommation qui freine l'équipe est celle que la sentinelle lit chez le fournisseur.",
    loading: "Chargement…",
    refresh: "actualiser",
    missing:
      "La sentinelle n'a pas encore écrit la consommation : on ne sait pas combien l'équipe a consommé.",
    fresh: (min) => `lu il y a ${min} min`,
    stale: (min) =>
      `donnée vieille de ${min} min : ce n'est plus la consommation actuelle`,
    provider: "Fournisseur",
    window5h: "Fenêtre de 5 heures",
    windowWeek: "Semaine du fournisseur",
    total: "Total",
    unattributed: "Non attribué",
    role: "Rôle",
    share: "Part",
    agents: "Agents",
    noRoles: "Aucune consommation dans cette fenêtre.",
    hourTitle: "Dernière heure par agent",
    hourNone: "Aucun agent avec des journaux lisibles dans la dernière heure.",
  },
  de: {
    breadcrumb: "Verbrauch",
    title: "Verbrauch des Anbieters",
    subtitle: "Was das Team verbraucht hat, wie die Sentinelle es misst",
    notConfigurable: "Hier werden keine Limits gesetzt",
    notConfigurableBody:
      "Diese Seite ist schreibgeschützt. Anfragelimits sind nicht konfigurierbar: Den Verbrauch, der das Team bremst, liest die Sentinelle beim Anbieter ab.",
    loading: "Wird geladen…",
    refresh: "aktualisieren",
    missing:
      "Die Sentinelle hat den Verbrauch noch nicht geschrieben: es ist nicht bekannt, wie viel das Team verbraucht hat.",
    fresh: (min) => `vor ${min} Min. gelesen`,
    stale: (min) =>
      `Wert ist ${min} Min. alt: nicht mehr der aktuelle Verbrauch`,
    provider: "Anbieter",
    window5h: "5-Stunden-Fenster",
    windowWeek: "Woche des Anbieters",
    total: "Gesamt",
    unattributed: "Nicht zugeordnet",
    role: "Rolle",
    share: "Anteil",
    agents: "Agenten",
    noRoles: "Kein Verbrauch in diesem Fenster.",
    hourTitle: "Letzte Stunde je Agent",
    hourNone: "Kein Agent mit lesbaren Logs in der letzten Stunde.",
  },
  hu: {
    breadcrumb: "Fogyasztás",
    title: "A szolgáltató fogyasztása",
    subtitle: "Mennyit fogyasztott a csapat, ahogy az őr méri",
    notConfigurable: "Itt nem lehet korlátot beállítani",
    notConfigurableBody:
      "Ez az oldal csak olvasható. A kérésenkénti korlátok nem állíthatók: a csapatot az a fogyasztás fékezi, amelyet az őr a szolgáltatótól olvas ki.",
    loading: "Betöltés…",
    refresh: "frissítés",
    missing:
      "Az őr még nem írta ki a fogyasztást: nem tudni, mennyit fogyasztott a csapat.",
    fresh: (min) => `${min} perce olvasva`,
    stale: (min) => `${min} perces adat: már nem a mostani fogyasztás`,
    provider: "Szolgáltató",
    window5h: "5 órás ablak",
    windowWeek: "A szolgáltató hete",
    total: "Összesen",
    unattributed: "Nem hozzárendelt",
    role: "Szerep",
    share: "Arány",
    agents: "Ügynökök",
    noRoles: "Ebben az ablakban nincs fogyasztás.",
    hourTitle: "Az utolsó óra ügynökönként",
    hourNone: "Az utolsó órában nincs olvasható naplójú ügynök.",
  },
  pt: {
    breadcrumb: "Consumo",
    title: "Consumo do fornecedor",
    subtitle: "O que a equipa consumiu, como a sentinela mede",
    notConfigurable: "Aqui não se definem limites",
    notConfigurableBody:
      "Esta página é somente leitura. Os limites de requisições não são configuráveis: o consumo que freia a equipa é o que a sentinela lê do fornecedor.",
    loading: "A carregar…",
    refresh: "atualizar",
    missing:
      "A sentinela ainda não escreveu o consumo: não se sabe quanto a equipa consumiu.",
    fresh: (min) => `lido há ${min} min`,
    stale: (min) => `dado de ${min} min atrás: já não é o consumo atual`,
    provider: "Fornecedor",
    window5h: "Janela de 5 horas",
    windowWeek: "Semana do fornecedor",
    total: "Total",
    unattributed: "Não atribuído",
    role: "Função",
    share: "Parcela",
    agents: "Agentes",
    noRoles: "Sem consumo nesta janela.",
    hourTitle: "Última hora por agente",
    hourNone: "Nenhum agente com registros legíveis na última hora.",
  },
};

type RoleUsage = {
  role: string;
  kt: number | null;
  sharePct: number | null;
  agents: number | null;
  events: number | null;
};
type WindowUsage = {
  id: "5h" | "week";
  since: string | null;
  totalKt: number | null;
  unattributedKt: number | null;
  roles: RoleUsage[];
};
type UsageData = {
  limitsConfigurable: false;
  available: boolean;
  generatedAt: string | null;
  ageSec: number | null;
  fresh: boolean;
  provider: string | null;
  windows: WindowUsage[];
  agents1h: { agent: string; tokens: number }[];
  ts: number;
};

// Un numero che la sentinella non ha scritto si legge «—», mai 0.
function kt(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString()} kt`;
}

function WindowCard({ w, t }: { w: WindowUsage; t: Texts }) {
  const title = w.id === "5h" ? t.window5h : t.windowWeek;
  return (
    <div
      className="border rounded-lg overflow-hidden"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-panel)",
      }}
    >
      <div
        className="px-5 py-4 border-b flex items-baseline justify-between gap-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <p className="text-[13px] font-bold text-[var(--color-white)]">
          {title}
        </p>
        <p className="text-[10px] font-mono text-[var(--color-bright)]">
          {t.total}: {kt(w.totalKt)}
        </p>
      </div>
      <div className="px-5 py-4">
        {w.roles.length === 0 ? (
          <p className="text-[11px] text-[var(--color-dim)]">{t.noRoles}</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[9px] text-[var(--color-dim)] uppercase tracking-widest">
                <th className="pb-2 font-normal">{t.role}</th>
                <th className="pb-2 font-normal text-right">kt</th>
                <th className="pb-2 font-normal text-right">{t.share}</th>
                <th className="pb-2 font-normal text-right">{t.agents}</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[var(--color-bright)]">
              {w.roles.map((r) => (
                <tr key={r.role}>
                  <td className="py-0.5">{r.role}</td>
                  <td className="py-0.5 text-right">
                    {r.kt === null ? "—" : r.kt.toLocaleString()}
                  </td>
                  <td className="py-0.5 text-right">
                    {r.sharePct === null ? "—" : `${r.sharePct}%`}
                  </td>
                  <td className="py-0.5 text-right">{r.agents ?? "—"}</td>
                </tr>
              ))}
              {w.unattributedKt ? (
                <tr className="text-[var(--color-dim)]">
                  <td className="py-0.5">{t.unattributed}</td>
                  <td className="py-0.5 text-right">
                    {w.unattributedKt.toLocaleString()}
                  </td>
                  <td />
                  <td />
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function RateLimiterPage() {
  const t = T[useLocale()];
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/rate-limiter").catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const minutes =
    data?.ageSec != null ? Math.max(0, Math.round(data.ageSec / 60)) : 0;

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
            {t.breadcrumb}
          </span>
        </nav>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              {t.title}
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {t.subtitle}
              {data?.available && data.provider && (
                <span className="ml-2 font-mono">
                  · {t.provider}: {data.provider}
                </span>
              )}
              {data?.available && (
                <span
                  className={`ml-2 ${data.fresh ? "" : "text-[var(--color-yellow)]"}`}
                >
                  · {data.fresh ? t.fresh(minutes) : t.stale(minutes)}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-all"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-muted)",
              background: "transparent",
            }}
          >
            ↻ {t.refresh}
          </button>
        </div>
      </div>

      <div
        className="mb-6 px-4 py-3 rounded-lg border"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-card)",
        }}
        role="note"
      >
        <p className="text-[12px] font-bold text-[var(--color-white)]">
          {t.notConfigurable}
        </p>
        <p className="text-[11px] text-[var(--color-muted)] mt-1">
          {t.notConfigurableBody}
        </p>
      </div>

      {loading && (
        <div
          className="flex justify-center py-16"
          role="status"
          aria-live="polite"
        >
          <span className="text-[var(--color-dim)] text-[12px]">
            {t.loading}
          </span>
        </div>
      )}

      {data && !data.available && (
        <p className="text-[12px] text-[var(--color-muted)]" role="status">
          {t.missing}
        </p>
      )}

      {data?.available && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.windows.map((w) => (
              <WindowCard key={w.id} w={w} t={t} />
            ))}
          </div>
          <h2 className="mt-8 mb-3 text-[13px] font-bold text-[var(--color-white)]">
            {t.hourTitle}
          </h2>
          {data.agents1h.length === 0 ? (
            <p className="text-[11px] text-[var(--color-dim)]">{t.hourNone}</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px] font-mono">
              {data.agents1h.map((a) => (
                <li
                  key={a.agent}
                  className="flex justify-between px-3 py-2 rounded border"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "var(--color-card)",
                  }}
                >
                  <span className="text-[var(--color-bright)]">{a.agent}</span>
                  <span className="text-[var(--color-muted)]">
                    {a.tokens.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
