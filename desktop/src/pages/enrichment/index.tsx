import { useCallback, useEffect, useMemo, useState } from "react";
import { PageTitle } from "../settings/embedded";
import { ToastProvider, useToast } from "@/app/components/Toast";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import {
  readTeamSettings,
  switchValueIsValid,
  writeTeamSettings,
  type EnrichmentPatch,
  type EnrichmentPolicy,
  type EnrichmentSwitch,
  type TeamSettings,
} from "../../lib/team-settings-native";
import type { PageProps } from "../types";
import { ENRICHMENT_TEXT, type EnrichmentText } from "./enrichment.i18n";

type Loaded = { kind: "loading" } | { kind: "failed"; code: string } | { kind: "ready"; settings: TeamSettings };

/** The form: the switches as booleans, the thresholds as the text of their fields («» is no threshold). */
interface Draft {
  economy: boolean;
  logo: boolean;
  logoMin: string;
  geocodePipeline: boolean;
  geocodeMissing: boolean;
  geocodeMin: string;
  nonRemoteOnly: boolean;
  recheck: boolean;
  recheckMin: string;
  recheckDays: string;
}

function draftOf(p: EnrichmentPolicy): Draft {
  const text = (n: number | null) => (n === null ? "" : String(n));
  return {
    economy: p.economy, logo: p.logo.enabled, logoMin: text(p.logo.min_score), geocodePipeline: p.geocode_pipeline.enabled,
    geocodeMissing: p.geocode_missing.enabled, geocodeMin: text(p.geocode_missing.min_score), nonRemoteOnly: p.geocode_missing.non_remote_only,
    recheck: p.recheck_weekly.enabled, recheckMin: text(p.recheck_weekly.min_score), recheckDays: text(p.recheck_weekly.older_than_days),
  };
}

/** «» is null, digits are a number, anything else is NaN (refused). */
function numberOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** The switches that changed, each with its value; or the sentence that says why the form cannot be sent. */
export function patchOf(saved: EnrichmentPolicy, draft: Draft, t: EnrichmentText): { patch: EnrichmentPatch } | { error: string } {
  const values: Array<[EnrichmentSwitch, boolean | number | null, boolean | number | null]> = [
    ["economy", draft.economy, saved.economy],
    ["logo.enabled", draft.logo, saved.logo.enabled],
    ["logo.min_score", numberOf(draft.logoMin), saved.logo.min_score],
    ["geocode_pipeline.enabled", draft.geocodePipeline, saved.geocode_pipeline.enabled],
    ["geocode_missing.enabled", draft.geocodeMissing, saved.geocode_missing.enabled],
    ["geocode_missing.min_score", numberOf(draft.geocodeMin), saved.geocode_missing.min_score],
    ["geocode_missing.non_remote_only", draft.nonRemoteOnly, saved.geocode_missing.non_remote_only],
    ["recheck_weekly.enabled", draft.recheck, saved.recheck_weekly.enabled],
    ["recheck_weekly.min_score", numberOf(draft.recheckMin), saved.recheck_weekly.min_score],
    ["recheck_weekly.older_than_days", numberOf(draft.recheckDays), saved.recheck_weekly.older_than_days],
  ];
  const patch: EnrichmentPatch = {};
  for (const [key, value, before] of values) {
    if (!switchValueIsValid(key, value)) return { error: key === "recheck_weekly.older_than_days" ? t.invalidDays : t.invalidScore };
    if (value !== before) patch[key] = value;
  }
  return { patch };
}

function failureText(code: string): string {
  const copy = describeError(code, { fallback: "team_settings_unavailable", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

const rowCls = "flex items-center gap-2 text-[12px] text-[var(--color-bright)]";
const fieldCls =
  "w-16 rounded border border-[var(--color-border)] bg-transparent px-2 py-0.5 text-[12px] text-[var(--color-bright)]";

function Toggle({ id, label, checked, onChange, disabled = false }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={rowCls} htmlFor={id}>
      <input id={id} data-testid={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function NumberField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className={`${rowCls} pl-6 text-[var(--color-muted)]`} htmlFor={id}>
      <span>{label}</span>
      <input id={id} data-testid={id} inputMode="numeric" className={fieldCls} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  );
}

function EnrichmentCard({ settings, onSaved }: { settings: TeamSettings; onSaved: (s: TeamSettings) => void }) {
  const t = ENRICHMENT_TEXT[appLocale()];
  const { toast } = useToast();
  const reading = settings.enrichment!;
  const initial = useMemo(() => draftOf(reading.policy), [reading.policy]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(initial), [initial]);
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const planned = patchOf(reading.policy, draft, t);
  // a form that cannot be sent is still a change: Save says why instead of staying grey
  const changed = "error" in planned || Object.keys(planned.patch).length > 0;

  const save = async () => {
    if ("error" in planned) {
      setError(planned.error);
      return;
    }
    setBusy(true);
    setError(null);
    const done = await writeTeamSettings({ enrichment: planned.patch }, settings.connectionKey);
    setBusy(false);
    if (!done.ok) {
      setError(failureText(done.error));
      return;
    }
    onSaved(done.settings);
    toast(t.saved, "success");
  };

  return (
    <div className="flex flex-col gap-2" data-testid="enrichment-card">
      {reading.mode === "saving" && <p role="status" className="m-0 text-[12px] text-[var(--color-yellow)]">{t.modeSaving}</p>}
      {reading.mode === "unknown" && <p role="status" className="m-0 text-[12px] text-[var(--color-yellow)]">{t.modeUnknown}</p>}
      <Toggle id="enrichment-economy" label={t.economy} checked={draft.economy} onChange={set("economy")} />
      <p className="m-0 pl-6 text-[11px] text-[var(--color-muted)]">{t.economyNote}</p>
      <Toggle id="enrichment-logo" label={t.logo} checked={draft.logo} onChange={set("logo")} />
      <NumberField id="enrichment-logo-min" label={t.minScore} value={draft.logoMin} onChange={set("logoMin")} hint={t.minScoreNone} />
      <Toggle id="enrichment-geocode-pipeline" label={t.geocodePipeline} checked={draft.geocodePipeline} onChange={set("geocodePipeline")} />
      <Toggle id="enrichment-geocode-missing" label={t.geocodeMissing} checked={draft.geocodeMissing} onChange={set("geocodeMissing")} />
      <NumberField id="enrichment-geocode-min" label={t.minScore} value={draft.geocodeMin} onChange={set("geocodeMin")} hint={t.minScoreNone} />
      <div className="pl-6">
        <Toggle id="enrichment-non-remote" label={t.nonRemoteOnly} checked={draft.nonRemoteOnly} onChange={set("nonRemoteOnly")} />
      </div>
      <Toggle id="enrichment-recheck" label={t.recheck} checked={draft.recheck} onChange={set("recheck")} />
      <NumberField id="enrichment-recheck-min" label={t.minScore} value={draft.recheckMin} onChange={set("recheckMin")} />
      <NumberField id="enrichment-recheck-days" label={t.olderThan} value={draft.recheckDays} onChange={set("recheckDays")} />
      <p className="m-0 text-[11px] text-[var(--color-muted)]">{t.thresholds}</p>
      {error && <p role="alert" data-testid="enrichment-error" className="m-0 text-[12px] text-[var(--color-yellow)]">{error}</p>}
      <div>
        <button
          type="button"
          data-testid="enrichment-save"
          disabled={!changed || busy}
          onClick={() => void save()}
          className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)] disabled:opacity-40"
        >
          {t.save}
        </button>
      </div>
    </div>
  );
}

/**
 * Settings › Team › Enrichments (JHT-T324): the switches of what the Analisti do on their own to complete a position, for the
 * team of this computer or of the linked VPS, through the native `team_settings` command (the box's enrichment_policy.py
 * writes the file, all or nothing). A save is the team's: what it answers, read back, is what the card shows. A team whose
 * image does not send the switches is told so, never shown made-up ones.
 */
function Enrichment() {
  const t = ENRICHMENT_TEXT[appLocale()];
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const load = useCallback(async () => {
    setLoaded({ kind: "loading" });
    const read = await readTeamSettings();
    setLoaded(read.ok ? { kind: "ready", settings: read.settings } : { kind: "failed", code: read.error });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2" aria-labelledby="enrichment-title">
      <PageTitle id="enrichment-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.title}</PageTitle>
      <p className="m-0 text-[12px] text-[var(--color-muted)]">{t.intro}</p>
      {loaded.kind === "loading" && <p role="status" className="m-0 text-[12px] text-[var(--color-muted)]">{t.loading}</p>}
      {loaded.kind === "failed" && (
        <div role="alert" data-testid="enrichment-failed" className="text-[12px]">
          <p className="m-0 text-[var(--color-yellow)]">{t.loadFailed}</p>
          <p className="m-0 mt-1 text-[var(--color-muted)]">{failureText(loaded.code)}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)]">
            {t.retry}
          </button>
        </div>
      )}
      {loaded.kind === "ready" && !loaded.settings.enrichment && (
        <p role="status" data-testid="enrichment-outdated" className="m-0 text-[12px] text-[var(--color-muted)]">{t.outdated}</p>
      )}
      {loaded.kind === "ready" && loaded.settings.enrichment && (
        <EnrichmentCard settings={loaded.settings} onSaved={(settings) => setLoaded({ kind: "ready", settings })} />
      )}
    </section>
  );
}

export default function EnrichmentPage(_props: PageProps) {
  return (
    <ToastProvider>
      <Enrichment />
    </ToastProvider>
  );
}
