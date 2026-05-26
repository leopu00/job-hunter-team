"use client";

/**
 * WorkHoursPicker — UI minimale per configurare le ore di lavoro del team.
 *
 * Round 2 (no heatmap, no bar chart): timezone + 5 preset + custom mode
 * con chip giorni e HH:MM input. Live preview: ore/sett, target_pct
 * stimato per la finestra 5h corrente, prossima transizione ON↔OFF.
 *
 * Storage: jht.config.json via /api/team/working-hours. Lo stesso file
 * che legge il CLI (`jht wh ...`) e il pacing-bridge dentro il container.
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

type Preview = {
  work_phase?: "ON" | "OFF";
  current_window_target_pct?: number;
  target_pct_of_weekly?: number;
  active_hours_in_window?: number;
  weekly_active_hours?: number;
  window_cap_pct_of_weekly?: number | null;
  next_phase_transition_at?: string | null;
  provider_active?: string;
};

type PresetKey = "office" | "weekend" | "daytime" | "night" | "24-7" | "custom";

const ALL_DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<Weekday, string> = {
  mon: "Lun", tue: "Mar", wed: "Mer", thu: "Gio",
  fri: "Ven", sat: "Sab", sun: "Dom",
};

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

function computeWeeklyHours(cfg: WorkingHoursConfig | null): number {
  if (!cfg || !cfg.windows?.length) return 168;
  let total = 0;
  for (const w of cfg.windows) {
    const [sh, sm] = w.start.split(":").map(Number);
    const [eh, em] = w.end.split(":").map(Number);
    let h = (eh + em / 60) - (sh + sm / 60);
    if (h <= 0) h += 24;
    total += h * (w.days?.length || 0);
  }
  return Math.round(total * 10) / 10;
}

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

export default function WorkHoursPicker() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<WorkingHoursConfig | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const preset: PresetKey = useMemo(() => detectPreset(cfg), [cfg]);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/team/working-hours", { cache: "no-store" });
      const data = await r.json();
      setCfg(data.working_hours ?? null);
      setPreview(data.preview ?? null);
    } catch (e) {
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
      // Trasforma config corrente in custom (clone) per editing libero.
      const base = cfg
        ? { ...cfg, windows: cfg.windows.map((w) => ({ ...w, days: [...w.days] })) }
        : { timezone: detectLocalTz(), windows: [{ days: ["mon","tue","wed","thu","fri"] as Weekday[], start: "09:00", end: "18:00" }] };
      setCfg(base);
      return;
    }
    const p = PRESETS[key];
    if (!p.cfg) {
      save(null);
      return;
    }
    save({ ...p.cfg, timezone: cfg?.timezone || detectLocalTz() });
  }, [cfg, save]);

  const updateWindow = (idx: number, patch: Partial<WorkingHoursWindow>) => {
    if (!cfg) return;
    const windows = cfg.windows.map((w, i) => i === idx ? { ...w, ...patch } : w);
    setCfg({ ...cfg, windows });
  };

  const toggleDay = (idx: number, day: Weekday) => {
    if (!cfg) return;
    const w = cfg.windows[idx];
    const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day];
    updateWindow(idx, { days: days.sort((a,b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b)) as Weekday[] });
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-6">
        <h2 className="text-lg font-medium mb-2">📅 Working hours</h2>
        <p className="text-sm opacity-60">Caricamento…</p>
      </div>
    );
  }

  const weeklyHours = computeWeeklyHours(cfg);
  const isCustom = preset === "custom";

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
              (preset === k
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
            (preset === "custom"
              ? "border-orange-500 bg-orange-500/10 text-orange-300"
              : "border-[var(--color-border)] hover:border-orange-500/50")
          }
        >
          <span className="mr-1.5">🎛️</span>
          Custom
        </button>
      </div>

      {/* Custom editor */}
      {isCustom && cfg && (
        <div className="space-y-4 mt-4 pt-4 border-t border-[var(--color-border)]">
          <div>
            <label className="block text-xs opacity-60 mb-1">Timezone IANA</label>
            <input
              type="text"
              value={cfg.timezone}
              onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}
              placeholder={detectLocalTz()}
              className="px-2 py-1 rounded bg-transparent border border-[var(--color-border)] text-sm w-64"
            />
            <button
              type="button"
              onClick={() => setCfg({ ...cfg, timezone: detectLocalTz() })}
              className="ml-2 text-xs opacity-60 hover:opacity-100"
            >
              usa locale ({detectLocalTz()})
            </button>
          </div>

          {cfg.windows.map((w, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {ALL_DAYS.map((d) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(idx, d)}
                    className={
                      "px-2.5 py-1 rounded text-xs border transition " +
                      (w.days.includes(d)
                        ? "border-orange-500 bg-orange-500/20 text-orange-200"
                        : "border-[var(--color-border)] opacity-50 hover:opacity-100")
                    }
                  >
                    {DAY_LABELS[d]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <label className="opacity-60">Dalle</label>
                <input
                  type="time"
                  value={w.start}
                  onChange={(e) => updateWindow(idx, { start: e.target.value })}
                  className="px-2 py-1 rounded bg-transparent border border-[var(--color-border)]"
                />
                <label className="opacity-60">alle</label>
                <input
                  type="time"
                  value={w.end}
                  onChange={(e) => updateWindow(idx, { end: e.target.value })}
                  className="px-2 py-1 rounded bg-transparent border border-[var(--color-border)]"
                />
              </div>
            </div>
          ))}

          <button
            onClick={() => save(cfg)}
            disabled={saving || !cfg.windows[0]?.days.length}
            className="px-4 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-sm disabled:opacity-40"
          >
            {saving ? "Salvataggio…" : "💾 Salva custom"}
          </button>
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
            <div className="text-xs opacity-60">Provider</div>
            <div className="font-mono mt-1">
              {preview.provider_active || "—"}
              {preview.window_cap_pct_of_weekly != null && (
                <span className="opacity-60 ml-1 text-xs">
                  (ratio {preview.window_cap_pct_of_weekly}%)
                </span>
              )}
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
