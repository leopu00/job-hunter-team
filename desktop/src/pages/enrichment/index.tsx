import { useCallback, useEffect, useMemo, useState } from "react";
import { PageTitle } from "../settings/embedded";
import { ToastProvider, useToast } from "@/app/components/Toast";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import {
  extraCost,
  readTeamSettings,
  switchValueIsValid,
  valueAt,
  writeTeamSettings,
  type EnrichmentCosts,
  type EnrichmentPatch,
  type EnrichmentPolicy,
  type EnrichmentSwitch,
  type ExtraCost,
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
  webAnalista: boolean;
  webScout: boolean;
  webMentor: boolean;
}

function draftOf(p: EnrichmentPolicy): Draft {
  const text = (n: number | null) => (n === null ? "" : String(n));
  return {
    economy: p.economy, logo: p.logo.enabled, logoMin: text(p.logo.min_score), geocodePipeline: p.geocode_pipeline.enabled,
    geocodeMissing: p.geocode_missing.enabled, geocodeMin: text(p.geocode_missing.min_score), nonRemoteOnly: p.geocode_missing.non_remote_only,
    recheck: p.recheck_weekly.enabled, recheckMin: text(p.recheck_weekly.min_score), recheckDays: text(p.recheck_weekly.older_than_days),
    webAnalista: p.web_search.analista.enabled, webScout: p.web_search.scout.enabled, webMentor: p.web_search.mentor.enabled,
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
    ["web_search.analista.enabled", draft.webAnalista, saved.web_search.analista.enabled],
    ["web_search.scout.enabled", draft.webScout, saved.web_search.scout.enabled],
    ["web_search.mentor.enabled", draft.webMentor, saved.web_search.mentor.enabled],
  ];
  const patch: EnrichmentPatch = {};
  for (const [key, value, before] of values) {
    if (!switchValueIsValid(key, value)) return { error: key === "recheck_weekly.older_than_days" ? t.invalidDays : t.invalidScore };
    if (value !== before) patch[key] = value;
  }
  return { patch };
}

function nameOf(key: EnrichmentSwitch, t: EnrichmentText): string {
  switch (key) {
    case "economy": return t.economyOff;
    case "logo.enabled": return t.logo;
    case "geocode_pipeline.enabled": return t.geocodePipeline;
    case "geocode_missing.enabled": return t.geocodeMissing;
    case "geocode_missing.non_remote_only": return t.nonRemoteOnly;
    case "recheck_weekly.enabled": return t.recheck;
    case "web_search.analista.enabled": return t.webAnalista;
    case "web_search.scout.enabled": return t.webScout;
    case "web_search.mentor.enabled": return t.webMentor;
    default: return key;
  }
}

/** Dollars in the person's language: 0,008 · 0,40. */
export function money(value: number, locale: string): string {
  const digits = value !== 0 && value < 0.01 ? 3 : 2;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value);
}

/** The sentence of what a change costs more, in the person's language (the same words as `jht enrichment set`). */
export function costSentence(key: EnrichmentSwitch, cost: ExtraCost, t: EnrichmentText, locale: string): string {
  const fill = (template: string, vars: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
  const name = nameOf(key, t);
  if ("unmeasured" in cost) return fill(t.costUnmeasured, { name });
  if ("perSearch" in cost) return fill(t.costPerSearch, { name, usd: money(cost.perSearch, locale) });
  return fill(t.costPerPosition, { name, usd: money(cost.perPosition, locale), day: money(cost.perDay, locale), n: cost.positionsPerDay });
}

/** The sentences of the changes of `patch` that cost more, in the order of the list; empty when none does. */
export function costsOf(patch: EnrichmentPatch, saved: EnrichmentPolicy, costs: EnrichmentCosts | undefined, t: EnrichmentText, locale: string): string[] {
  const out: string[] = [];
  for (const [key, after] of Object.entries(patch) as Array<[EnrichmentSwitch, boolean | number | null]>) {
    const cost = extraCost(key, valueAt(saved, key), after, costs);
    if (cost) out.push(costSentence(key, cost, t, locale));
  }
  return out;
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
  // the sentences of the extra cost the person is asked to confirm; null while nothing waits for a yes
  const [asking, setAsking] = useState<string[] | null>(null);
  useEffect(() => setDraft(initial), [initial]);
  // a change to the form takes back a question already asked: what is confirmed is what is on screen
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => {
    setAsking(null);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const planned = patchOf(reading.policy, draft, t);
  // a form that cannot be sent is still a change: Save says why instead of staying grey
  const changed = "error" in planned || Object.keys(planned.patch).length > 0;

  const locale = appLocale();
  const dearer = "error" in planned ? [] : costsOf(planned.patch, reading.policy, reading.costs, t, locale);

  const save = async (confirmed = false) => {
    if ("error" in planned) {
      setError(planned.error);
      return;
    }
    if (dearer.length > 0 && !confirmed) {
      setAsking(dearer);
      return;
    }
    setAsking(null);
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
      <p className="m-0 mt-1 text-[12px] font-semibold text-[var(--color-bright)]">{t.webSearch}</p>
      <Toggle id="enrichment-web-analista" label={t.webAnalista} checked={draft.webAnalista} onChange={set("webAnalista")} />
      <Toggle id="enrichment-web-scout" label={t.webScout} checked={draft.webScout} onChange={set("webScout")} />
      <Toggle id="enrichment-web-mentor" label={t.webMentor} checked={draft.webMentor} onChange={set("webMentor")} />
      {dearer.length > 0 && !asking && (
        <ul data-testid="enrichment-cost" className="m-0 pl-4 text-[11px] text-[var(--color-yellow)]">
          {dearer.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {asking && (
        <div role="alertdialog" aria-labelledby="enrichment-confirm-title" data-testid="enrichment-confirm" className="rounded border border-[var(--color-yellow)] p-2 flex flex-col gap-1">
          <p id="enrichment-confirm-title" className="m-0 text-[12px] font-semibold text-[var(--color-bright)]">{t.confirmTitle}</p>
          <ul className="m-0 pl-4 text-[12px] text-[var(--color-yellow)]">
            {asking.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <div className="flex gap-2">
            <button type="button" data-testid="enrichment-confirm-yes" onClick={() => void save(true)} className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)]">
              {t.confirm}
            </button>
            <button type="button" data-testid="enrichment-confirm-no" onClick={() => setAsking(null)} className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-muted)]">
              {t.cancel}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" data-testid="enrichment-error" className="m-0 text-[12px] text-[var(--color-yellow)]">{error}</p>}
      <div>
        <button
          type="button"
          data-testid="enrichment-save"
          disabled={!changed || busy || asking !== null}
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
