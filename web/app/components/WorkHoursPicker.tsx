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
import { useLocale } from "@/lib/use-locale";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./WorkHoursPicker.i18n";

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
const DAY_TKEY: Record<Weekday, string> = {
  mon: "day_mon",
  tue: "day_tue",
  wed: "day_wed",
  thu: "day_thu",
  fri: "day_fri",
  sat: "day_sat",
  sun: "day_sun",
};
const PRESET_TKEY: Record<Exclude<PresetKey, "custom">, string> = {
  office: "preset_office",
  weekend: "preset_weekend",
  daytime: "preset_daytime",
  night: "preset_night",
  "24-7": "preset_247",
};
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const PRESETS: Record<
  Exclude<PresetKey, "custom">,
  { icon: string; cfg: WorkingHoursConfig | null }
> = {
  office: {
    icon: "💼",
    cfg: {
      timezone: "",
      windows: [
        {
          days: ["mon", "tue", "wed", "thu", "fri"],
          start: "09:00",
          end: "18:00",
        },
      ],
    },
  },
  weekend: {
    icon: "🌴",
    cfg: {
      timezone: "",
      windows: [{ days: ["sat", "sun"], start: "09:00", end: "18:00" }],
    },
  },
  daytime: {
    icon: "☀️",
    cfg: {
      timezone: "",
      windows: [{ days: ALL_DAYS, start: "09:00", end: "18:00" }],
    },
  },
  night: {
    icon: "🌙",
    cfg: {
      timezone: "",
      windows: [{ days: ALL_DAYS, start: "22:00", end: "07:00" }],
    },
  },
  "24-7": { icon: "🌐", cfg: null },
};

function detectLocalTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/* ─── Range-per-giorno helpers ──────────────────────────────────────── */
// Vincoli (decisione utente 2026-06-19): UN solo blocco CONTIGUO per giorno,
// minimo MIN_DAY_HOURS, default 9h. La notte (start > end, es. 22:00→07:00)
// e' un blocco contiguo che attraversa la mezzanotte, gestito nativamente da
// questo modello e dall'algoritmo Python a runtime.

const MIN_DAY_HOURS = 4;
const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";
const HOUR_OPTIONS = HOURS.map((h) => `${String(h).padStart(2, "0")}:00`);

// Schedule editabile di un giorno: acceso/spento + un solo blocco start→end.
type DaySched = { on: boolean; start: string; end: string };

// Durata in ore di un blocco HH:MM→HH:MM, con wrap di mezzanotte
// (es. 22:00→07:00 = 9h). Allineata a windowDurationHours di shared/config.
function blockHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let h = eh + em / 60 - (sh + sm / 60);
  if (h <= 0) h += 24;
  return h;
}

function isWrap(start: string, end: string): boolean {
  return (
    start !== "" && end !== "" && blockHours(start, end) > 0 && end <= start
  );
}

// cfg → 7 schedule (uno per giorno). null/vuoto (24/7) → base daytime 9h
// modificabile: in custom mode si parte da un orario sensato, non da 24h.
function schedFromConfig(cfg: WorkingHoursConfig | null): DaySched[] {
  if (!cfg || !cfg.windows?.length) {
    return ALL_DAYS.map(() => ({
      on: true,
      start: DEFAULT_START,
      end: DEFAULT_END,
    }));
  }
  const out: DaySched[] = ALL_DAYS.map(() => ({
    on: false,
    start: DEFAULT_START,
    end: DEFAULT_END,
  }));
  for (const w of cfg.windows) {
    for (const d of w.days) {
      const di = ALL_DAYS.indexOf(d);
      if (di >= 0) out[di] = { on: true, start: w.start, end: w.end };
    }
  }
  return out;
}

// 7 schedule → config: raggruppa i giorni ON per (start,end) → una window
// per orario distinto (ogni giorno compare in al piu' una window → valido
// per lo schema, contiguita' garantita).
function configFromSched(
  sched: DaySched[],
  timezone: string,
): WorkingHoursConfig {
  const byKey = new Map<
    string,
    { start: string; end: string; days: Weekday[] }
  >();
  sched.forEach((s, di) => {
    if (!s.on) return;
    const key = `${s.start}-${s.end}`;
    if (!byKey.has(key))
      byKey.set(key, { start: s.start, end: s.end, days: [] });
    byKey.get(key)!.days.push(ALL_DAYS[di]);
  });
  const windows: WorkingHoursWindow[] = Array.from(byKey.values()).map((w) => ({
    days: w.days,
    start: w.start,
    end: w.end,
  }));
  return { timezone: timezone || detectLocalTz(), windows };
}

// Giorni ON che violano i vincoli (durata < min, oppure start == end).
function invalidDays(sched: DaySched[]): number[] {
  const bad: number[] = [];
  sched.forEach((s, di) => {
    if (!s.on) return;
    if (s.start === s.end || blockHours(s.start, s.end) < MIN_DAY_HOURS)
      bad.push(di);
  });
  return bad;
}

function schedHoursPerDay(sched: DaySched[]): number[] {
  return sched.map((s) => (s.on ? blockHours(s.start, s.end) : 0));
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
      pw.start === w.start &&
      pw.end === w.end &&
      pw.days.length === w.days.length &&
      pw.days.every((d) => w.days.includes(d))
    )
      return key as PresetKey;
  }
  return "custom";
}

function fmtTransition(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function computeWeeklyHours(cfg: WorkingHoursConfig | null): number {
  if (!cfg || !cfg.windows?.length) return 168;
  let total = 0;
  for (const w of cfg.windows) {
    total += blockHours(w.start, w.end) * (w.days?.length ?? 0);
  }
  return Math.round(total * 10) / 10;
}

/* ─── Component ─────────────────────────────────────────────────────── */

export default function WorkHoursPicker() {
  const { toast } = useToast();
  const locale = useLocale();
  const tr = makeT(T, locale);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<WorkingHoursConfig | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Modificabile solo dall'app desktop (host localhost). Dal browser cloud la UI
  // e' sola visualizzazione (pattern WEB-READONLY). Default true finche' la GET
  // non dice il contrario, cosi' in locale non c'e' flash di "read-only".
  const [editable, setEditable] = useState(true);
  const preset: PresetKey = useMemo(() => detectPreset(cfg), [cfg]);
  // Editing schedule (range per giorno): stato locale che vive solo in custom
  // mode. Sincronizzato con cfg all'ingresso in custom, applicato via "Salva".
  const [editSched, setEditSched] = useState<DaySched[] | null>(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/team/working-hours", { cache: "no-store" });
      const data = await r.json();
      setCfg(data.working_hours ?? null);
      setPreview(data.preview ?? null);
      setEditable(data.editable !== false);
    } catch {
      toast(tr("toast_load_err"), "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, locale]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const save = useCallback(
    async (next: WorkingHoursConfig | null) => {
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
        setEditSched(null);
        toast(
          next === null ? tr("toast_removed") : tr("toast_saved"),
          "success",
        );
      } catch (e: any) {
        toast(tr("toast_err").replace("{msg}", e.message), "error");
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, locale],
  );

  const applyPreset = useCallback(
    (key: PresetKey) => {
      if (key === "custom") {
        // Entra in custom: deriva lo schedule per-giorno dal config corrente.
        setEditSched(schedFromConfig(cfg));
        return;
      }
      setEditSched(null);
      const p = PRESETS[key];
      if (!p.cfg) {
        save(null);
        return;
      }
      save({ ...p.cfg, timezone: cfg?.timezone || detectLocalTz() });
    },
    [cfg, save],
  );

  const toggleDay = (di: number) => {
    if (!editSched) return;
    setEditSched(editSched.map((s, i) => (i === di ? { ...s, on: !s.on } : s)));
  };

  const setDayField = (di: number, field: "start" | "end", value: string) => {
    if (!editSched) return;
    setEditSched(
      editSched.map((s, i) => (i === di ? { ...s, [field]: value } : s)),
    );
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-6">
        <h2 className="text-lg font-medium mb-2">📅 {tr("wh_title")}</h2>
        <p className="text-sm opacity-60">{tr("loading")}</p>
      </div>
    );
  }

  const isCustom = preset === "custom" || editSched !== null;
  const sched = editSched ?? schedFromConfig(cfg);
  const badDays = invalidDays(sched);
  const noDayOn = sched.every((s) => !s.on);
  // perDayHours: in custom dallo schedule editato; in non-custom dal cfg reale
  // (24/7 = 24h/giorno, altrimenti la durata del blocco di quel giorno).
  const perDayHours: number[] = isCustom
    ? schedHoursPerDay(sched)
    : !cfg || !cfg.windows?.length
      ? ALL_DAYS.map(() => 24)
      : ALL_DAYS.map((d) => {
          const w = (cfg.windows ?? []).find((x) => x.days.includes(d));
          return w ? blockHours(w.start, w.end) : 0;
        });
  const weeklyHours = isCustom
    ? Math.round(perDayHours.reduce((a, h) => a + h, 0) * 10) / 10
    : computeWeeklyHours(cfg);
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
      msg: tr("warn_low").replace("{pct}", String(wasted)),
    };
  } else if (!unlimited && maxH != null && weeklyHours > maxH) {
    sweetSpotWarn = {
      kind: "high",
      msg: tr("warn_high").replace(
        "{h}",
        String(Math.round(weeklyHours - maxH)),
      ),
    };
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-6">
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium">📅 {tr("wh_title")}</h2>
          <p className="text-xs opacity-60 mt-1">{tr("wh_desc")}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono">{weeklyHours}h</div>
          <div className="text-xs opacity-60">{tr("per_week")}</div>
        </div>
      </div>

      {!editable && (
        <div className="mb-4 text-xs px-3 py-2 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
          {tr("read_only_desktop")}
        </div>
      )}

      {/* Preset chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((k) => (
          <button
            key={k}
            disabled={saving || !editable}
            onClick={() => editable && applyPreset(k as PresetKey)}
            className={
              "px-3 py-1.5 rounded-md border text-sm transition " +
              (preset === k && !editSched
                ? "border-orange-500 bg-orange-500/10 text-orange-300"
                : "border-[var(--color-border)] hover:border-orange-500/50")
            }
          >
            <span className="mr-1.5">{PRESETS[k].icon}</span>
            {tr(PRESET_TKEY[k])}
          </button>
        ))}
        <button
          disabled={saving || !editable}
          onClick={() => editable && applyPreset("custom")}
          className={
            "px-3 py-1.5 rounded-md border text-sm transition " +
            (isCustom
              ? "border-orange-500 bg-orange-500/10 text-orange-300"
              : "border-[var(--color-border)] hover:border-orange-500/50")
          }
        >
          <span className="mr-1.5">🎛️</span>
          {tr("custom")}
        </button>
      </div>

      {/* Editor range-per-giorno (solo in custom mode + app desktop) */}
      {editable && isCustom && (
        <div className="space-y-4 mt-4 pt-4 border-t border-[var(--color-border)]">
          <div>
            <label className="block text-xs opacity-60 mb-1">
              {tr("tz_label")}
            </label>
            <input
              type="text"
              value={cfg?.timezone ?? detectLocalTz()}
              onChange={(e) =>
                setCfg({
                  ...(cfg ?? { windows: [] }),
                  timezone: e.target.value,
                })
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
              {tr("tz_use_local").replace("{tz}", detectLocalTz())}
            </button>
          </div>

          <div>
            <p className="text-xs opacity-60 mb-3">{tr("day_range_hint")}</p>
            <div className="space-y-1.5">
              {ALL_DAYS.map((d, di) => {
                const s = sched[di];
                const bad = badDays.includes(di);
                const dur = s.on ? blockHours(s.start, s.end) : 0;
                const wrap = s.on && isWrap(s.start, s.end);
                return (
                  <div key={d} className="flex items-center gap-3 text-sm py-1">
                    <button
                      type="button"
                      onClick={() => toggleDay(di)}
                      className={
                        "w-14 text-left px-2 py-1 rounded border transition select-none " +
                        (s.on
                          ? "border-orange-500/60 bg-orange-500/10 text-orange-300"
                          : "border-[var(--color-border)] opacity-50 hover:opacity-80")
                      }
                    >
                      {tr(DAY_TKEY[d])}
                    </button>
                    {s.on ? (
                      <>
                        <select
                          value={s.start}
                          onChange={(e) =>
                            setDayField(di, "start", e.target.value)
                          }
                          className="px-2 py-1 rounded bg-transparent border border-[var(--color-border)] font-mono text-sm"
                        >
                          {HOUR_OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        <span className="opacity-50">→</span>
                        <select
                          value={s.end}
                          onChange={(e) =>
                            setDayField(di, "end", e.target.value)
                          }
                          className="px-2 py-1 rounded bg-transparent border border-[var(--color-border)] font-mono text-sm"
                        >
                          {HOUR_OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        <span
                          className={
                            "font-mono text-xs " +
                            (bad ? "text-red-400" : "opacity-60")
                          }
                        >
                          {dur}h{wrap ? ` · 🌙 ${tr("night_label")}` : ""}
                          {bad
                            ? ` · ${tr("min_hours_err").replace("{n}", String(MIN_DAY_HOURS))}`
                            : ""}
                        </span>
                      </>
                    ) : (
                      <span className="opacity-40 text-xs">
                        {tr("day_off")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2">
            <button
              onClick={() => {
                if (!editSched) return;
                save(
                  configFromSched(editSched, cfg?.timezone || detectLocalTz()),
                );
              }}
              disabled={saving || badDays.length > 0 || noDayOn}
              className="px-4 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-sm disabled:opacity-40"
            >
              {saving ? tr("saving") : `💾 ${tr("save_custom")}`}
            </button>
            <button
              onClick={() => {
                setEditSched(null);
                loadState();
              }}
              disabled={saving}
              className="ml-2 px-4 py-1.5 rounded-md border border-[var(--color-border)] hover:border-white/30 text-sm"
            >
              {tr("cancel")}
            </button>
            {(badDays.length > 0 || noDayOn) && (
              <span className="ml-3 text-xs text-red-400">
                {noDayOn ? tr("need_one_day") : tr("fix_blocks")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bar chart per-giorno (sempre visibile) */}
      <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
        <div className="text-xs opacity-60 mb-2">
          {tr("weekly_distribution")}
        </div>
        <div className="space-y-1.5">
          {ALL_DAYS.map((d, di) => {
            const h = perDayHours[di];
            const pct = weeklyHours > 0 ? (h / weeklyHours) * 100 : 0;
            const widthPct = (h / maxDayHours) * 100;
            return (
              <div key={d} className="flex items-center text-xs gap-2">
                <div className="w-10 opacity-60">{tr(DAY_TKEY[d])}</div>
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
              {tr("sweet_spot_provider")}{" "}
              <span className="font-mono opacity-100">{provInfo.provider}</span>
            </div>
            {unlimited ? (
              <div className="text-xs text-green-400">
                {tr("weekly_unlimited")}
              </div>
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
              {sweetSpotWarn.kind === "low"
                ? tr("below_sweet_spot")
                : tr("above_sweet_spot")}
              : {sweetSpotWarn.msg}
            </div>
          )}
        </div>
      )}

      {/* Live preview dal container */}
      {preview && (
        <div className="mt-6 pt-4 border-t border-[var(--color-border)] grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs opacity-60">{tr("current_phase")}</div>
            <div
              className={
                "font-mono mt-1 " +
                (preview.work_phase === "ON"
                  ? "text-green-400"
                  : "text-orange-400")
              }
            >
              {preview.work_phase === "ON" ? "🟢 ON" : "🟠 OFF"}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-60">{tr("window_target")}</div>
            <div className="font-mono mt-1">
              {typeof preview.current_window_target_pct === "number"
                ? `${preview.current_window_target_pct.toFixed(0)}%`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-60">{tr("next_transition")}</div>
            <div className="font-mono mt-1">
              {fmtTransition(preview.next_phase_transition_at)}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-60">{tr("ratio_cap")}</div>
            <div className="font-mono mt-1">
              {preview.window_cap_pct_of_weekly != null
                ? `${preview.window_cap_pct_of_weekly}%`
                : "—"}
            </div>
          </div>
        </div>
      )}

      {!preview && cfg && (
        <p className="mt-4 text-xs opacity-50">{tr("preview_hint")}</p>
      )}
    </div>
  );
}

/* ─── Sweet-spot bar (sub-component) ────────────────────────────────── */

function SweetSpotBar({
  weeklyHours,
  minH,
  maxH,
}: {
  weeklyHours: number;
  minH: number;
  maxH: number;
}) {
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
        <span
          style={{
            position: "absolute",
            left: `${minPct}%`,
            transform: "translateX(-50%)",
          }}
        >
          min {minH}h
        </span>
        <span
          style={{
            position: "absolute",
            left: `${maxPct}%`,
            transform: "translateX(-50%)",
          }}
        >
          max {maxH}h
        </span>
        <span>{Math.round(scaleMax)}h</span>
      </div>
    </div>
  );
}
