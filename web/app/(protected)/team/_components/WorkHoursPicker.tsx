"use client";

/**
 * WorkHoursPicker — UI completa di configurazione working hours.
 *
 * Round 2: form (preset + custom day/HH:MM) + live preview compute_target.
 * Round 3 (questo file): heatmap 7×24 cliccabile, bar chart per-giorno,
 * sweet-spot meter (vincoli min/max ore in base al provider).
 *
 * Storage: jht.config.json via /api/team/working-hours. Lo stesso file
 * che legge il CLI (`jht wh`) e il pacing-bridge.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/app/components/Toast";

type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type WorkingHoursWindow = {
  days: Weekday[];
  start: string;
  end: string;
};

type WorkingHoursConfig = {
  timezone: string;
  windows: WorkingHoursWindow[];
};

type ProviderInfo = {
  provider?: string;
  effective_pct?: number | null;
  weekly_unlimited?: boolean;
  sweet_spot_min_hours?: number | null;
  sweet_spot_max_hours?: number | null;
  seed_burn_pct_per_h?: number | null;
};

type Preview = {
  work_phase?: "ON" | "OFF";
  current_window_target_pct?: number;
  target_pct_of_weekly?: number;
  active_hours_in_window?: number;
  weekly_active_hours?: number;
  window_cap_pct_of_weekly?: number | null;
  next_phase_transition_at?: string | null;
  provider_active?: string;
  provider?: ProviderInfo;
};

type PresetKey = "office" | "weekend" | "daytime" | "night" | "24-7" | "custom";

const ALL_DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<Weekday, string> = {
  mon: "Lun", tue: "Mar", wed: "Mer", thu: "Gio",
  fri: "Ven", sat: "Sab", sun: "Dom",
};
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const PRESETS: Record<
  Exclude<PresetKey, "custom">,
  { label: string; icon: string; cfg: WorkingHoursConfig | null }
> = {
  office:   { label: "Office (Lun-Ven 9-18)",  icon: "💼",
              cfg: { timezone: "", windows: [{ days: ["mon","tue","wed","thu","fri"], start: "09:00", end: "18:00" }] } },
  weekend:  { label: "Weekend (Sab-Dom 9-18)", icon: "🌴",
              cfg: { timezone: "", windows: [{ days: ["sat","sun"], start: "09:00", end: "18:00" }] } },
  daytime:  { label: "Tutti i giorni 9-18",    icon: "☀️",
              cfg: { timezone: "", windows: [{ days: ALL_DAYS, start: "09:00", end: "18:00" }] } },
  night:    { label: "Notturno (22-07)",       icon: "🌙",
              cfg: { timezone: "", windows: [{ days: ALL_DAYS, start: "22:00", end: "07:00" }] } },
  "24-7":   { label: "24/7 (sempre attivo)",   icon: "🌐", cfg: null },
};

function detectLocalTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}

/* ─── Heatmap helpers ───────────────────────────────────────────────── */

type CellGrid = boolean[][];  // [day_idx 0..6][hour 0..23]

function gridFromConfig(cfg: WorkingHoursConfig | null): CellGrid {
  const grid: CellGrid = Array.from({ length: 7 }, () => new Array(24).fill(false));
  if (!cfg || !cfg.windows?.length) {
    return grid.map(row => row.map(() => true));  // 24/7 = tutto ON
  }
  for (const w of cfg.windows) {
    const [sh, sm] = w.start.split(":").map(Number);
    const [eh, em] = w.end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const wraps = endMin <= startMin;
    for (const d of w.days) {
      const di = ALL_DAYS.indexOf(d);
      if (di < 0) continue;
      for (let h = 0; h < 24; h++) {
        const hMin = h * 60;
        const inside = wraps
          ? (hMin >= startMin || hMin < endMin)
          : (hMin >= startMin && hMin < endMin);
        if (inside) grid[di][h] = true;
      }
    }
  }
  return grid;
}

/** Converte una grid 7×24 in una lista di WorkingHoursWindow minimali.
 *  Pattern: per ogni giorno trova run consecutivi di celle ON, crea una
 *  window per run. Poi raggruppa windows con stesso start/end e merge
 *  i loro days. Risultato: schema compatto e valido. */
function configFromGrid(grid: CellGrid, timezone: string): WorkingHoursConfig {
  // 1) Per ogni giorno → lista di (start_hour, end_hour) chiuso aperto
  const perDay: Array<Array<{ start: number; end: number }>> = grid.map((row) => {
    const runs: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i < 24) {
      if (!row[i]) { i++; continue; }
      const s = i;
      while (i < 24 && row[i]) i++;
      runs.push({ start: s, end: i });
    }
    return runs;
  });

  // 2) Raggruppa run-by-run per chiave (start,end) → days
  const byKey = new Map<string, { start: number; end: number; days: Weekday[] }>();
  perDay.forEach((runs, di) => {
    for (const r of runs) {
      const key = `${r.start}-${r.end}`;
      if (!byKey.has(key)) {
        byKey.set(key, { start: r.start, end: r.end, days: [] });
      }
      byKey.get(key)!.days.push(ALL_DAYS[di]);
    }
  });

  const windows: WorkingHoursWindow[] = Array.from(byKey.values()).map((w) => ({
    days: w.days,
    start: `${String(w.start).padStart(2, "0")}:00`,
    end: w.end === 24 ? "00:00" : `${String(w.end).padStart(2, "0")}:00`,
  }));
  return { timezone: timezone || detectLocalTz(), windows };
}

function isAllOn(grid: CellGrid): boolean {
  return grid.every(row => row.every(cell => cell));
}

/* ─── Bar chart per-giorno ──────────────────────────────────────────── */

function hoursPerDay(grid: CellGrid): number[] {
  return grid.map(row => row.filter(Boolean).length);
}

/* ─── Preset detection ──────────────────────────────────────────────── */

function detectPreset(cfg: WorkingHoursConfig | null): PresetKey {
  if (!cfg || !cfg.windows?.length) return "24-7";
  if (cfg.windows.length !== 1) return "custom";
  const w = cfg.windows[0];
  for (const [key, p] of Object.entries(PRESETS)) {
    if (!p.cfg) continue;
    const pw = p.cfg.windows[0];
    if (
      pw.start === w.start && pw.end === w.end &&
      pw.days.length === w.days.length &&
      pw.days.every((d) => w.days.includes(d))
    ) return key as PresetKey;
  }
  return "custom";
}

function fmtTransition(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function computeWeeklyHours(cfg: WorkingHoursConfig | null): number {
  if (!cfg || !cfg.windows?.length) return 168;
  return gridFromConfig(cfg).reduce(
    (acc, row) => acc + row.filter(Boolean).length,
    0,
  );
}

/* ─── Component ─────────────────────────────────────────────────────── */

export default function WorkHoursPicker() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<WorkingHoursConfig | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const preset: PresetKey = useMemo(() => detectPreset(cfg), [cfg]);
  // Editing grid: stato locale che vive solo in custom mode. Sincronizzata
  // con cfg quando preset cambia, e applicata via "Salva" per persistere.
  const [editGrid, setEditGrid] = useState<CellGrid | null>(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/team/working-hours", { cache: "no-store" });
      const data = await r.json();
      setCfg(data.working_hours ?? null);
      setPreview(data.preview ?? null);
    } catch {
      toast("Errore caricamento working hours", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadState(); }, [loadState]);

  const save = useCallback(async (next: WorkingHoursConfig | null) => {
    setSaving(true);
    try {
      const r = await fetch("/api/team/working-hours", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ working_hours: next }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setCfg(data.working_hours ?? null);
      setPreview(data.preview ?? null);
      setEditGrid(null);
      toast(
        next === null
          ? "Team 24/7 (working hours rimosse)"
          : "Working hours salvate",
        "success",
      );
    } catch (e: any) {
      toast(`Errore: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  }, [toast]);

  const applyPreset = useCallback((key: PresetKey) => {
    if (key === "custom") {
      // Entra in custom: clona il config corrente nella editGrid.
      setEditGrid(gridFromConfig(cfg));
      return;
    }
    setEditGrid(null);
    const p = PRESETS[key];
    if (!p.cfg) {
      save(null);
      return;
    }
    save({ ...p.cfg, timezone: cfg?.timezone || detectLocalTz() });
  }, [cfg, save]);

  const toggleCell = (di: number, hr: number) => {
    if (!editGrid) return;
    const next = editGrid.map((row, i) =>
      i === di ? row.map((c, h) => (h === hr ? !c : c)) : row,
    );
    setEditGrid(next);
  };

  const toggleDayRow = (di: number) => {
    if (!editGrid) return;
    const allOn = editGrid[di].every(Boolean);
    const next = editGrid.map((row, i) =>
      i === di ? row.map(() => !allOn) : row,
    );
    setEditGrid(next);
  };

  const toggleHourCol = (hr: number) => {
    if (!editGrid) return;
    const allOn = editGrid.every(row => row[hr]);
    const next = editGrid.map(row => row.map((c, h) => (h === hr ? !allOn : c)));
    setEditGrid(next);
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-6">
        <h2 className="text-lg font-medium mb-2">📅 Working hours</h2>
        <p className="text-sm opacity-60">Caricamento…</p>
      </div>
    );
  }

  const isCustom = preset === "custom" || editGrid !== null;
  const grid = editGrid ?? gridFromConfig(cfg);
  const weeklyHours = isCustom
    ? grid.reduce((a, r) => a + r.filter(Boolean).length, 0)
    : computeWeeklyHours(cfg);
  const perDayHours = hoursPerDay(grid);
  const maxDayHours = Math.max(...perDayHours, 1);

  const provInfo = preview?.provider;
  const minH = provInfo?.sweet_spot_min_hours ?? null;
  const maxH = provInfo?.sweet_spot_max_hours ?? null;
  const unlimited = provInfo?.weekly_unlimited;
  let sweetSpotWarn: { kind: "low" | "high"; msg: string } | null = null;
  if (!unlimited && minH != null && weeklyHours > 0 && weeklyHours < minH) {
    const wasted = Math.round((1 - weeklyHours / minH) * 100);
    sweetSpotWarn = {
      kind: "low",
      msg: `~${wasted}% del weekly budget non sarà utilizzato (troppe poche ore).`,
    };
  } else if (!unlimited && maxH != null && weeklyHours > maxH) {
    sweetSpotWarn = {
      kind: "high",
      msg: `Le finestre 5h userebbero <25% del cap (overhead alto). Riduci di ~${Math.round(weeklyHours - maxH)}h.`,
    };
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-6">
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium">📅 Working hours</h2>
          <p className="text-xs opacity-60 mt-1">
            Le ore in cui il team lavora. Il budget weekly viene distribuito solo su queste ore.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono">{weeklyHours}h</div>
          <div className="text-xs opacity-60">/ settimana</div>
        </div>
      </div>

      {/* Preset chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((k) => (
          <button
            key={k}
            disabled={saving}
            onClick={() => applyPreset(k as PresetKey)}
            className={
              "px-3 py-1.5 rounded-md border text-sm transition " +
              (preset === k && !editGrid
                ? "border-orange-500 bg-orange-500/10 text-orange-300"
                : "border-[var(--color-border)] hover:border-orange-500/50")
            }
          >
            <span className="mr-1.5">{PRESETS[k].icon}</span>
            {PRESETS[k].label}
          </button>
        ))}
        <button
          disabled={saving}
          onClick={() => applyPreset("custom")}
          className={
            "px-3 py-1.5 rounded-md border text-sm transition " +
            (isCustom
              ? "border-orange-500 bg-orange-500/10 text-orange-300"
              : "border-[var(--color-border)] hover:border-orange-500/50")
          }
        >
          <span className="mr-1.5">🎛️</span>
          Custom
        </button>
      </div>

      {/* Timezone + heatmap (solo in custom mode) */}
      {isCustom && (
        <div className="space-y-4 mt-4 pt-4 border-t border-[var(--color-border)]">
          <div>
            <label className="block text-xs opacity-60 mb-1">Timezone IANA</label>
            <input
              type="text"
              value={cfg?.timezone ?? detectLocalTz()}
              onChange={(e) =>
                setCfg({ ...(cfg ?? { windows: [] }), timezone: e.target.value })
              }
              placeholder={detectLocalTz()}
              className="px-2 py-1 rounded bg-transparent border border-[var(--color-border)] text-sm w-64"
            />
            <button
              type="button"
              onClick={() =>
                setCfg({
                  ...(cfg ?? { windows: [] }),
                  timezone: detectLocalTz(),
                })
              }
              className="ml-2 text-xs opacity-60 hover:opacity-100"
            >
              usa locale ({detectLocalTz()})
            </button>
          </div>

          <div className="overflow-x-auto">
            <p className="text-xs opacity-60 mb-2">
              Clicca le celle per attivare/disattivare. Click sul giorno o sull&apos;ora per toggle riga/colonna.
            </p>
            <table className="border-separate" style={{ borderSpacing: "1px" }}>
              <thead>
                <tr>
                  <th></th>
                  {HOURS.map((h) => (
                    <th
                      key={h}
                      onClick={() => toggleHourCol(h)}
                      className="text-[10px] font-normal opacity-50 hover:opacity-100 cursor-pointer w-5 text-center"
                    >
                      {h % 3 === 0 ? h : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_DAYS.map((d, di) => (
                  <tr key={d}>
                    <td
                      onClick={() => toggleDayRow(di)}
                      className="text-xs pr-2 cursor-pointer opacity-70 hover:opacity-100 select-none"
                    >
                      {DAY_LABELS[d]}
                    </td>
                    {HOURS.map((h) => (
                      <td
                        key={h}
                        onClick={() => toggleCell(di, h)}
                        className={
                          "w-5 h-5 rounded cursor-pointer transition " +
                          (grid[di][h]
                            ? "bg-orange-500 hover:bg-orange-400"
                            : "bg-white/5 hover:bg-white/10")
                        }
                        title={`${DAY_LABELS[d]} ${String(h).padStart(2,"0")}:00`}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => {
              if (!editGrid) return;
              if (isAllOn(editGrid)) {
                save(null); // tutto ON = 24/7 = nessun config
              } else {
                save(configFromGrid(editGrid, cfg?.timezone || detectLocalTz()));
              }
            }}
            disabled={saving || weeklyHours === 0}
            className="px-4 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-sm disabled:opacity-40"
          >
            {saving ? "Salvataggio…" : "💾 Salva custom"}
          </button>
          <button
            onClick={() => { setEditGrid(null); loadState(); }}
            disabled={saving}
            className="ml-2 px-4 py-1.5 rounded-md border border-[var(--color-border)] hover:border-white/30 text-sm"
          >
            Annulla
          </button>
        </div>
      )}

      {/* Bar chart per-giorno (sempre visibile) */}
      <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
        <div className="text-xs opacity-60 mb-2">Distribuzione settimanale</div>
        <div className="space-y-1.5">
          {ALL_DAYS.map((d, di) => {
            const h = perDayHours[di];
            const pct = weeklyHours > 0 ? (h / weeklyHours) * 100 : 0;
            const widthPct = (h / maxDayHours) * 100;
            return (
              <div key={d} className="flex items-center text-xs gap-2">
                <div className="w-10 opacity-60">{DAY_LABELS[d]}</div>
                <div className="flex-1 bg-white/5 rounded h-3.5 overflow-hidden">
                  <div
                    className="h-full bg-orange-500/70 transition-all"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <div className="w-24 text-right opacity-70 font-mono">
                  {h}h{h > 0 && weeklyHours > 0 ? ` · ${pct.toFixed(0)}%` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sweet-spot meter */}
      {provInfo && (
        <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs opacity-60">
              Sweet spot — provider <span className="font-mono opacity-100">{provInfo.provider}</span>
            </div>
            {unlimited ? (
              <div className="text-xs text-green-400">🟢 Weekly unlimited (nessun vincolo)</div>
            ) : (
              <div className="text-xs opacity-70 font-mono">
                {minH}h ↔ {maxH}h
              </div>
            )}
          </div>
          {!unlimited && minH != null && maxH != null && (
            <SweetSpotBar weeklyHours={weeklyHours} minH={minH} maxH={maxH} />
          )}
          {sweetSpotWarn && (
            <div
              className={
                "mt-2 text-xs px-3 py-2 rounded " +
                (sweetSpotWarn.kind === "low"
                  ? "bg-red-500/10 text-red-300 border border-red-500/30"
                  : "bg-yellow-500/10 text-yellow-300 border border-yellow-500/30")
              }
            >
              {sweetSpotWarn.kind === "low" ? "⚠️ Sotto sweet spot" : "⚠️ Sopra sweet spot"}: {sweetSpotWarn.msg}
            </div>
          )}
        </div>
      )}

      {/* Live preview dal container */}
      {preview && (
        <div className="mt-6 pt-4 border-t border-[var(--color-border)] grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs opacity-60">Fase corrente</div>
            <div className={
              "font-mono mt-1 " +
              (preview.work_phase === "ON" ? "text-green-400" : "text-orange-400")
            }>
              {preview.work_phase === "ON" ? "🟢 ON" : "🟠 OFF"}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-60">Target finestra 5h</div>
            <div className="font-mono mt-1">
              {typeof preview.current_window_target_pct === "number"
                ? `${preview.current_window_target_pct.toFixed(0)}%`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-60">Prossima transizione</div>
            <div className="font-mono mt-1">{fmtTransition(preview.next_phase_transition_at)}</div>
          </div>
          <div>
            <div className="text-xs opacity-60">Ratio cap-5h / weekly</div>
            <div className="font-mono mt-1">
              {preview.window_cap_pct_of_weekly != null
                ? `${preview.window_cap_pct_of_weekly}%`
                : "—"}
            </div>
          </div>
        </div>
      )}

      {!preview && cfg && (
        <p className="mt-4 text-xs opacity-50">
          ℹ️ Preview disponibile solo con container attivo (`jht team start`).
        </p>
      )}
    </div>
  );
}

/* ─── Sweet-spot bar (sub-component) ────────────────────────────────── */

function SweetSpotBar({
  weeklyHours, minH, maxH,
}: { weeklyHours: number; minH: number; maxH: number }) {
  const scaleMax = Math.max(maxH * 1.1, 168);
  const minPct = (minH / scaleMax) * 100;
  const maxPct = (maxH / scaleMax) * 100;
  const youPct = Math.min(100, (weeklyHours / scaleMax) * 100);
  return (
    <div className="relative h-8 bg-white/5 rounded overflow-hidden">
      {/* sweet band */}
      <div
        className="absolute top-0 bottom-0 bg-green-500/20"
        style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
      />
      {/* you marker */}
      <div
        className="absolute top-0 bottom-0 w-1 bg-orange-400"
        style={{ left: `calc(${youPct}% - 2px)` }}
        title={`${weeklyHours}h/sett`}
      />
      <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] opacity-60 font-mono pointer-events-none">
        <span>0h</span>
        <span style={{ position: "absolute", left: `${minPct}%`, transform: "translateX(-50%)" }}>min {minH}h</span>
        <span style={{ position: "absolute", left: `${maxPct}%`, transform: "translateX(-50%)" }}>max {maxH}h</span>
        <span>{Math.round(scaleMax)}h</span>
      </div>
    </div>
  );
}
