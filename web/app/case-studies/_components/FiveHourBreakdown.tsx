"use client";

import type { FiveHourWindow, BurnSample, AgentActivity } from "./types";
import { FiveHourWindowChart } from "./FiveHourWindowChart";
import { ZoomableChart } from "./ZoomableChart";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<string, Record<string, string>> = {
  header_title: {
    it: "⏱ Finestre rolling 5h ({n}) — peak della 5h-cap per finestra",
    en: "⏱ Rolling 5h windows ({n}) — peak 5h-cap per window",
    hu: "⏱ Gördülő 5 órás ablakok ({n}) — 5h-limit csúcs ablakonként",
    es: "⏱ Ventanas rodantes de 5h ({n}) — pico del límite 5h por ventana",
    de: "⏱ Rollierende 5h-Fenster ({n}) — Spitze des 5h-Limits pro Fenster",
    fr: "⏱ Fenêtres glissantes de 5h ({n}) — pic du plafond 5h par fenêtre",
    pt: "⏱ Janelas rolantes de 5h ({n}) — pico do limite 5h por janela",
  },
  cap_eq: {
    it: "cap = 92%",
    en: "cap = 92%",
    hu: "limit = 92%",
    es: "límite = 92%",
    de: "Limit = 92%",
    fr: "plafond = 92%",
    pt: "limite = 92%",
  },
  over_cap_count: {
    it: "· {n}/{tot} finestre oltre cap",
    en: "· {n}/{tot} windows over cap",
    hu: "· {n}/{tot} ablak a limit felett",
    es: "· {n}/{tot} ventanas sobre el límite",
    de: "· {n}/{tot} Fenster über dem Limit",
    fr: "· {n}/{tot} fenêtres au-delà du plafond",
    pt: "· {n}/{tot} janelas acima do limite",
  },
  window_label: {
    it: "Finestra {n}",
    en: "Window {n}",
    hu: "{n}. ablak",
    es: "Ventana {n}",
    de: "Fenster {n}",
    fr: "Fenêtre {n}",
    pt: "Janela {n}",
  },
  chart_aria: {
    it: "Finestre rolling 5 ore: utilizzo di picco del cap 5h per finestra",
    en: "Rolling 5-hour windows: peak 5h cap usage per window",
    hu: "Gördülő 5 órás ablakok: 5h-limit csúcskihasználtság ablakonként",
    es: "Ventanas rodantes de 5 horas: uso pico del límite 5h por ventana",
    de: "Rollierende 5-Stunden-Fenster: Spitzennutzung des 5h-Limits pro Fenster",
    fr: "Fenêtres glissantes de 5 heures : utilisation de pointe du plafond 5h par fenêtre",
    pt: "Janelas rolantes de 5 horas: uso de pico do limite 5h por janela",
  },
  cap_n: {
    it: "cap {n}%",
    en: "cap {n}%",
    hu: "limit {n}%",
    es: "límite {n}%",
    de: "Limit {n}%",
    fr: "plafond {n}%",
    pt: "limite {n}%",
  },
  legend_peak: {
    it: "peak 5h-cap %",
    en: "peak 5h-cap %",
    hu: "5h-limit csúcs %",
    es: "pico límite 5h %",
    de: "Spitze 5h-Limit %",
    fr: "pic plafond 5h %",
    pt: "pico limite 5h %",
  },
  legend_over_cap: {
    it: "oltre cap 92%",
    en: "over cap 92%",
    hu: "92% limit felett",
    es: "sobre límite 92%",
    de: "über Limit 92%",
    fr: "au-delà plafond 92%",
    pt: "acima limite 92%",
  },
  col_window: {
    it: "finestra",
    en: "window",
    hu: "ablak",
    es: "ventana",
    de: "Fenster",
    fr: "fenêtre",
    pt: "janela",
  },
  col_time_utc: {
    it: "orario (UTC)",
    en: "time (UTC)",
    hu: "idő (UTC)",
    es: "hora (UTC)",
    de: "Zeit (UTC)",
    fr: "heure (UTC)",
    pt: "hora (UTC)",
  },
  col_near_limit: {
    it: "quanto vicino al limite 5h?",
    en: "how close to the 5h limit?",
    hu: "milyen közel az 5h limithez?",
    es: "¿qué tan cerca del límite 5h?",
    de: "wie nah am 5h-Limit?",
    fr: "à quel point près du plafond 5h ?",
    pt: "quão perto do limite 5h?",
  },
  col_near_limit_title: {
    it: "quanto la finestra rolling 5h è arrivata vicino al limite del provider (cap 92%). Sopra cap = throttle",
    en: "how close the rolling 5h window got to the provider limit (92% cap). Over cap = throttle",
    hu: "mennyire került közel a gördülő 5h ablak a szolgáltató limitjéhez (92% limit). Limit felett = throttle",
    es: "qué tan cerca llegó la ventana rodante 5h al límite del proveedor (límite 92%). Sobre el límite = throttle",
    de: "wie nah das rollierende 5h-Fenster an das Provider-Limit kam (92% Limit). Über dem Limit = Throttle",
    fr: "à quel point la fenêtre glissante 5h s'est approchée du plafond du fournisseur (plafond 92%). Au-delà = throttle",
    pt: "quão perto a janela rolante 5h chegou do limite do provedor (limite 92%). Acima = throttle",
  },
  col_weekly_budget: {
    it: "budget settimanale",
    en: "weekly budget",
    hu: "heti keret",
    es: "presupuesto semanal",
    de: "Wochenbudget",
    fr: "budget hebdomadaire",
    pt: "orçamento semanal",
  },
  col_weekly_budget_title: {
    it: "totale del budget settimanale consumato fino a fine slice",
    en: "total weekly budget consumed up to the end of the slice",
    hu: "a teljes heti keret a szelet végéig elhasználva",
    es: "total del presupuesto semanal consumido hasta el final del segmento",
    de: "gesamtes Wochenbudget, verbraucht bis zum Ende des Abschnitts",
    fr: "total du budget hebdomadaire consommé jusqu'à la fin de la tranche",
    pt: "total do orçamento semanal consumido até o fim da fatia",
  },
  peak_title: {
    it: "picco 5h = {n}% (cap provider 92%)",
    en: "5h peak = {n}% (provider cap 92%)",
    hu: "5h csúcs = {n}% (szolgáltató limit 92%)",
    es: "pico 5h = {n}% (límite proveedor 92%)",
    de: "5h-Spitze = {n}% (Provider-Limit 92%)",
    fr: "pic 5h = {n}% (plafond fournisseur 92%)",
    pt: "pico 5h = {n}% (limite provedor 92%)",
  },
  cap_92_title: {
    it: "cap 92%",
    en: "cap 92%",
    hu: "limit 92%",
    es: "límite 92%",
    de: "Limit 92%",
    fr: "plafond 92%",
    pt: "limite 92%",
  },
  how_to_read: {
    it: "Come leggere",
    en: "How to read",
    hu: "Hogyan olvasd",
    es: "Cómo leer",
    de: "So liest du es",
    fr: "Comment lire",
    pt: "Como ler",
  },
  read_near_strong: {
    it: "Quanto vicino al limite 5h?",
    en: "How close to the 5h limit?",
    hu: "Milyen közel az 5h limithez?",
    es: "¿Qué tan cerca del límite 5h?",
    de: "Wie nah am 5h-Limit?",
    fr: "À quel point près du plafond 5h ?",
    pt: "Quão perto do limite 5h?",
  },
  read_near_1: {
    it: " Il provider (Codex Pro) blocca quando le ultime 5h superano il ",
    en: " The provider (Codex Pro) blocks when the last 5h exceed ",
    hu: " A szolgáltató (Codex Pro) blokkol, amikor az utolsó 5h meghaladja a ",
    es: " El proveedor (Codex Pro) bloquea cuando las últimas 5h superan el ",
    de: " Der Provider (Codex Pro) blockiert, wenn die letzten 5h die ",
    fr: " Le fournisseur (Codex Pro) bloque quand les 5 dernières heures dépassent ",
    pt: " O provedor (Codex Pro) bloqueia quando as últimas 5h ultrapassam ",
  },
  read_near_2: {
    it: " di consumo. La barra mostra il ",
    en: " of consumption. The bar shows the ",
    hu: "-os fogyasztást. A sáv a szeleten belül elért ",
    es: " de consumo. La barra muestra el ",
    de: " des Verbrauchs überschreiten. Der Balken zeigt die ",
    fr: " de consommation. La barre montre le ",
    pt: " de consumo. A barra mostra o ",
  },
  read_near_peak: {
    it: "picco",
    en: "peak",
    hu: "csúcsot",
    es: "pico",
    de: "Spitze",
    fr: "pic",
    pt: "pico",
  },
  read_near_3: {
    it: " raggiunto dentro la slice. Tacca grigia = soglia cap. Barra rossa = soglia sforata → throttle scattato.",
    en: " reached inside the slice. Grey notch = cap threshold. Red bar = threshold exceeded → throttle triggered.",
    hu: " jelzi. Szürke jelölés = limit küszöb. Piros sáv = küszöb túllépve → throttle aktiválva.",
    es: " alcanzado dentro del segmento. Marca gris = umbral del límite. Barra roja = umbral superado → throttle activado.",
    de: " innerhalb des Abschnitts. Graue Kerbe = Limit-Schwelle. Roter Balken = Schwelle überschritten → Throttle ausgelöst.",
    fr: " atteint dans la tranche. Encoche grise = seuil du plafond. Barre rouge = seuil dépassé → throttle déclenché.",
    pt: " alcançado dentro da fatia. Marca cinza = limiar do limite. Barra vermelha = limiar excedido → throttle acionado.",
  },
  read_budget_strong: {
    it: "Budget settimanale",
    en: "Weekly budget",
    hu: "Heti keret",
    es: "Presupuesto semanal",
    de: "Wochenbudget",
    fr: "Budget hebdomadaire",
    pt: "Orçamento semanal",
  },
  read_budget_1: {
    it: " = totale cumulativo della quota settimanale fino a fine slice (parte da 0%, finisce vicino al 100%). ",
    en: " = cumulative total of the weekly quota up to the end of the slice (starts at 0%, ends near 100%). ",
    hu: " = a heti kvóta kumulatív összege a szelet végéig (0%-ról indul, 100% közelében végződik). ",
    es: " = total acumulado de la cuota semanal hasta el final del segmento (empieza en 0%, termina cerca del 100%). ",
    de: " = kumulativer Gesamtwert des Wochenkontingents bis zum Ende des Abschnitts (beginnt bei 0%, endet nahe 100%). ",
    fr: " = total cumulé du quota hebdomadaire jusqu'à la fin de la tranche (commence à 0%, finit près de 100%). ",
    pt: " = total cumulativo da cota semanal até o fim da fatia (começa em 0%, termina perto de 100%). ",
  },
  read_budget_2: {
    it: " = quanti punti percentuali di quel budget sono stati spesi ",
    en: " = how many percentage points of that budget were spent ",
    hu: " = a keret hány százalékpontját költötték el ",
    es: " = cuántos puntos porcentuales de ese presupuesto se gastaron ",
    de: " = wie viele Prozentpunkte dieses Budgets ausgegeben wurden ",
    fr: " = combien de points de pourcentage de ce budget ont été dépensés ",
    pt: " = quantos pontos percentuais desse orçamento foram gastos ",
  },
  read_budget_only: {
    it: "solo",
    en: "only",
    hu: "csak",
    es: "solo",
    de: "nur",
    fr: "seulement",
    pt: "apenas",
  },
  read_budget_3: {
    it: " in questa slice.",
    en: " in this slice.",
    hu: " ebben a szeletben.",
    es: " en este segmento.",
    de: " in diesem Abschnitt.",
    fr: " dans cette tranche.",
    pt: " nesta fatia.",
  },
};

function tr(k: string, locale: Locale): string {
  return T[k]?.[locale] ?? T[k]?.en ?? k;
}

type Props = {
  windows: FiveHourWindow[];
  accentColor: string;
  burnSamples?: BurnSample[];
  agentActivity?: AgentActivity[];
};

type WinStats = {
  win: FiveHourWindow;
  peakCap5h: number; // 0..100, peak window_usage_pct inside this slice
  endCap5h: number; // window_usage_pct at the slice end
  startCap5h: number; // window_usage_pct at the slice start
  weeklyDeltaPp: number; // weekly burn pp consumed inside this slice
  weeklyEndPct: number; // cumulative weekly burn at slice end
};

const CAP_5H = 92; // hard cap della 5h rolling window (Codex Pro)

function computeStats(
  windows: FiveHourWindow[],
  burnSamples: BurnSample[] | undefined,
): WinStats[] {
  const samples = (burnSamples ?? [])
    .map((s) => ({
      t: new Date(s.ts).getTime(),
      w: s.window_usage_pct ?? 0,
      wk: s.weekly_usage_pct ?? 0,
    }))
    .sort((a, b) => a.t - b.t);
  return windows.map((w) => {
    const start = new Date(w.started_at).getTime();
    const end = new Date(w.ended_at).getTime();
    const inside = samples.filter((s) => s.t >= start && s.t <= end);
    if (inside.length === 0) {
      return {
        win: w,
        peakCap5h: 0,
        startCap5h: 0,
        endCap5h: 0,
        weeklyDeltaPp: Math.round((w.usage_delta_pct ?? 0) * 10) / 10,
        weeklyEndPct: w.usage_end_pct ?? 0,
      };
    }
    // I primi sample di una slice possono ereditare il valore della rolling 5h
    // della slice precedente (es. W7 inizia a 97% perché W6 stava ancora a 97%
    // e il reset arriva qualche minuto dopo). Se l'inizio è alto, scartiamo
    // i primi sample finché la curva non si svuota sotto soglia: da lì
    // parte il vero "lavoro fresco" della slice. Reset successivi non sono
    // eredità, sono parte del comportamento naturale (vecchi prompt che escono
    // dalla rolling 5h) e vanno tenuti.
    let firstFreshIdx = 0;
    const INHERITED_THRESHOLD = 50; // primo sample > 50% = ereditato
    const RESET_FLOOR = 20; // sotto questa soglia consideriamo la 5h "svuotata"
    if (inside[0].w > INHERITED_THRESHOLD) {
      for (let i = 0; i < inside.length; i++) {
        if (inside[i].w <= RESET_FLOOR) {
          firstFreshIdx = i;
          break;
        }
      }
    }
    const fresh = inside.slice(firstFreshIdx);
    const peakCap5h = Math.max(...fresh.map((s) => s.w));
    const startCap5h = fresh[0].w;
    const endCap5h = fresh[fresh.length - 1].w;
    return {
      win: w,
      peakCap5h,
      startCap5h,
      endCap5h,
      weeklyDeltaPp: Math.round((w.usage_delta_pct ?? 0) * 10) / 10,
      weeklyEndPct: w.usage_end_pct ?? 0,
    };
  });
}

// Rolling 5h sub-windows: per-window peak of the 5h provider cap.
// Cap 5h = 92% (provider rate limit). Bars > 92% = throttling.
export function FiveHourBreakdown({
  windows,
  accentColor,
  burnSamples,
  agentActivity,
}: Props) {
  const locale = useLocale();

  if (!windows || windows.length === 0) return null;

  const stats = computeStats(windows, burnSamples);
  const hasDetail =
    (burnSamples?.length ?? 0) > 0 || (agentActivity?.length ?? 0) > 0;
  const overCapCount = stats.filter((s) => s.peakCap5h > CAP_5H).length;

  return (
    <section className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h6 className="text-xs font-semibold text-[var(--color-bright)]">
          {tr("header_title", locale).replace("{n}", String(windows.length))}
        </h6>
        <span className="text-[10px] text-[var(--color-muted)]">
          {tr("cap_eq", locale)}
          {overCapCount > 0 && (
            <span className="ml-2 text-rose-600">
              {" "}
              {tr("over_cap_count", locale)
                .replace("{n}", String(overCapCount))
                .replace("{tot}", String(windows.length))}
            </span>
          )}
        </span>
      </header>

      <Chart stats={stats} accentColor={accentColor} />

      <Table stats={stats} accentColor={accentColor} />

      {hasDetail && (
        <div className="mt-4 flex flex-col gap-4">
          {windows.map((fhw) => {
            const start = new Date(fhw.started_at).getTime();
            const end = new Date(fhw.ended_at).getTime();
            const inWin = (ts: string) => {
              const t = new Date(ts).getTime();
              return t >= start && t <= end;
            };
            const samples = (burnSamples ?? []).filter((s) => inWin(s.ts));
            const activity = (agentActivity ?? []).filter((a) => {
              const s = new Date(a.ts_start).getTime();
              const e = new Date(a.ts_end).getTime();
              return s <= end && e >= start;
            });
            return (
              <ZoomableChart
                key={fhw.window_number}
                label={tr("window_label", locale).replace(
                  "{n}",
                  String(fhw.window_number),
                )}
              >
                <FiveHourWindowChart
                  fiveHourWindow={fhw}
                  samples={samples}
                  activity={activity}
                  accentColor={accentColor}
                />
              </ZoomableChart>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Chart({
  stats,
  accentColor,
}: {
  stats: WinStats[];
  accentColor: string;
}) {
  const locale = useLocale();
  const w = 720;
  const h = 200;
  const padL = 36;
  const padR = 24;
  const padT = 28;
  const padB = 30;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const totalH = stats.reduce((s, x) => s + x.win.duration_hours, 0);
  let acc = 0;
  const segments = stats.map((s) => {
    const x0 = padL + (acc / totalH) * innerW;
    acc += s.win.duration_hours;
    const x1 = padL + (acc / totalH) * innerW;
    return { ...s, x0, x1 };
  });

  const yPct = (pct: number) => padT + innerH * (1 - pct / 100);
  const yTicks = [0, 25, 50, 75, 100];
  const tickLabel = (iso: string) => iso.slice(11, 16);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-44 w-full"
      role="img"
      aria-label={tr("chart_aria", locale)}
    >
      {/* background bands per window */}
      {segments.map((s, i) => (
        <rect
          key={`band-${s.win.window_number}`}
          x={s.x0}
          y={padT}
          width={s.x1 - s.x0}
          height={innerH}
          fill={i % 2 === 0 ? "#f8fafc" : "#ffffff"}
        />
      ))}

      {/* Y grid */}
      {yTicks.map((t) => (
        <g key={`tick-${t}`}>
          <line
            x1={padL}
            x2={w - padR}
            y1={yPct(t)}
            y2={yPct(t)}
            stroke="#e2e8f0"
            strokeWidth="0.5"
          />
          <text
            x={padL - 4}
            y={yPct(t) + 3}
            fontSize="9"
            textAnchor="end"
            fill="#64748b"
          >
            {t}%
          </text>
        </g>
      ))}

      {/* 92% cap line */}
      <line
        x1={padL}
        x2={w - padR}
        y1={yPct(CAP_5H)}
        y2={yPct(CAP_5H)}
        stroke="#ef4444"
        strokeWidth="0.7"
        strokeDasharray="3 3"
      />
      <text
        x={w - padR - 2}
        y={yPct(CAP_5H) - 3}
        fontSize="9"
        textAnchor="end"
        fill="#ef4444"
      >
        {tr("cap_n", locale).replace("{n}", String(CAP_5H))}
      </text>

      {/* peak bars */}
      {segments.map((s) => {
        const barW = Math.max(8, (s.x1 - s.x0) * 0.55);
        const cx = (s.x0 + s.x1) / 2;
        const bx = cx - barW / 2;
        const by = yPct(s.peakCap5h);
        const bh = padT + innerH - by;
        const overCap = s.peakCap5h > CAP_5H;
        return (
          <g key={`bar-${s.win.window_number}`}>
            <rect
              x={bx}
              y={by}
              width={barW}
              height={bh}
              fill={overCap ? "#ef4444" : accentColor}
              fillOpacity={overCap ? 0.55 : 0.4}
              rx="2"
            />
            <text
              x={cx}
              y={by - 3}
              fontSize="9.5"
              textAnchor="middle"
              fill={overCap ? "#b91c1c" : "#0f172a"}
              fontWeight="700"
            >
              {Math.round(s.peakCap5h)}%
            </text>
          </g>
        );
      })}

      {/* Window separators + W# labels at top */}
      {segments.map((s, i) => (
        <g key={`sep-${s.win.window_number}`}>
          {i > 0 && (
            <line
              x1={s.x0}
              x2={s.x0}
              y1={padT}
              y2={padT + innerH}
              stroke="#cbd5e1"
              strokeWidth="0.5"
              strokeDasharray="2 3"
            />
          )}
          <rect
            x={s.x0 + 2}
            y={padT - 16}
            width={Math.max(18, s.x1 - s.x0 - 4)}
            height="13"
            fill={accentColor}
            fillOpacity="0.85"
            rx="2"
          />
          <text
            x={(s.x0 + s.x1) / 2}
            y={padT - 6}
            fontSize="9"
            textAnchor="middle"
            fill="white"
            fontWeight="700"
          >
            W{s.win.window_number}
          </text>
        </g>
      ))}

      {/* X-axis: time labels */}
      {segments.map((s, i) => (
        <text
          key={`xl-${i}`}
          x={s.x0}
          y={h - padB + 12}
          fontSize="8"
          textAnchor="middle"
          fill="#64748b"
        >
          {tickLabel(s.win.started_at)}
        </text>
      ))}
      <text
        x={segments[segments.length - 1].x1}
        y={h - padB + 12}
        fontSize="8"
        textAnchor="middle"
        fill="#64748b"
      >
        {tickLabel(segments[segments.length - 1].win.ended_at)}
      </text>

      {/* Legend */}
      <g transform={`translate(${padL}, ${h - 10})`}>
        <rect
          width="9"
          height="6"
          y="-5"
          fill={accentColor}
          fillOpacity="0.4"
          rx="1"
        />
        <text x="13" y="0" fontSize="8" fill="#475569">
          {tr("legend_peak", locale)}
        </text>
        <g transform="translate(110, 0)">
          <rect
            width="9"
            height="6"
            y="-5"
            fill="#ef4444"
            fillOpacity="0.55"
            rx="1"
          />
          <text x="13" y="0" fontSize="8" fill="#475569">
            {tr("legend_over_cap", locale)}
          </text>
        </g>
      </g>
    </svg>
  );
}

function Table({
  stats,
  accentColor,
}: {
  stats: WinStats[];
  accentColor: string;
}) {
  const locale = useLocale();
  const fmt = new Intl.DateTimeFormat("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
  const formatRange = (startIso: string, endIso: string) => {
    const a = fmt.format(new Date(startIso));
    const b = fmt.format(new Date(endIso));
    return `${a} → ${b}`;
  };
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2 pr-2 text-[10px] font-medium uppercase tracking-wide">
              {tr("col_window", locale)}
            </th>
            <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
              {tr("col_time_utc", locale)}
            </th>
            <th
              className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide"
              title={tr("col_near_limit_title", locale)}
            >
              {tr("col_near_limit", locale)}
            </th>
            <th
              className="py-2 pr-2 text-right text-[10px] font-medium uppercase tracking-wide"
              title={tr("col_weekly_budget_title", locale)}
            >
              {tr("col_weekly_budget", locale)}
            </th>
          </tr>
        </thead>
        <tbody className="font-mono text-[var(--color-bright)]">
          {stats.map((s) => {
            const overCap = s.peakCap5h > CAP_5H;
            return (
              <tr
                key={s.win.window_number}
                className="border-b border-[var(--color-border)] last:border-0"
              >
                <td className="py-2 pr-2 align-middle">
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    W{s.win.window_number}
                  </span>
                </td>
                <td className="py-2 pr-3 align-middle text-[11px] text-[var(--color-muted)]">
                  {formatRange(s.win.started_at, s.win.ended_at)}
                </td>
                <td className="py-2 pr-3 align-middle">
                  <div
                    className="flex items-center gap-2"
                    style={{ minWidth: 220 }}
                  >
                    <div
                      className="relative h-3.5 flex-1 overflow-hidden rounded-sm bg-[var(--color-card)]"
                      title={tr("peak_title", locale).replace(
                        "{n}",
                        String(Math.round(s.peakCap5h)),
                      )}
                    >
                      {/* Barra proporzionale 0..100% del peak diretto */}
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{
                          width: `${Math.min(100, Math.round(s.peakCap5h))}%`,
                          backgroundColor: overCap ? "#ef4444" : accentColor,
                          opacity: 0.55,
                        }}
                      />
                      {/* Tacca cap a 92% della barra (posizione vera del limite) */}
                      <div
                        className="absolute inset-y-0 w-px bg-slate-600"
                        style={{ left: `${CAP_5H}%` }}
                        title={tr("cap_92_title", locale)}
                      />
                    </div>
                    <span
                      className="whitespace-nowrap text-[12px] font-semibold tabular-nums"
                      style={{ color: overCap ? "#b91c1c" : "#0f172a" }}
                    >
                      {Math.round(s.peakCap5h)}%
                      {overCap && <span className="ml-1 text-[10px]">⚠️</span>}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-2 text-right align-middle">
                  <span className="text-[13px] font-semibold tabular-nums">
                    {s.weeklyEndPct}%
                  </span>
                  <span className="ml-1 text-[10px] text-[var(--color-muted)] tabular-nums">
                    (+{s.weeklyDeltaPp}pp)
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-deep)] p-3 text-[11px] leading-relaxed text-[var(--color-bright)]">
        <p className="mb-1 font-semibold text-[var(--color-bright)]">
          {tr("how_to_read", locale)}
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>{tr("read_near_strong", locale)}</strong>
            {tr("read_near_1", locale)}
            <strong>92%</strong>
            {tr("read_near_2", locale)}
            <em>{tr("read_near_peak", locale)}</em>
            {tr("read_near_3", locale)}
          </li>
          <li>
            <strong>{tr("read_budget_strong", locale)}</strong>
            {tr("read_budget_1", locale)}
            <em>+Xpp</em>
            {tr("read_budget_2", locale)}
            <em>{tr("read_budget_only", locale)}</em>
            {tr("read_budget_3", locale)}
          </li>
        </ul>
      </div>
    </div>
  );
}
