import { useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { buildAccountExport } from "../../lib/account-export";
import { describeError } from "../../lib/error-catalog";
import { pluralText } from "../../lib/plural";
import { fill } from "../../lib/text-slots";
import { EXPORT_FORMATS, EXPORT_SOURCES, exportTeamData, saveAccountExport, type ExportFormat, type ExportOutcome, type ExportSource } from "../../lib/team-export";
import { navigate } from "../../shell/router";
import type { PageProps } from "../types";
import { EXPORT_TEXT, type ExportText } from "./export.i18n";

const SOURCE_KEY = {
  positions: "srcPositions",
  scores: "srcScores",
  applications: "srcApplications",
  companies: "srcCompanies",
  feedback: "srcFeedback",
  notes: "srcNotes",
} as const satisfies Record<ExportSource, keyof ExportText>;

type Say = { ok: boolean; text: string };

function failureText(code: string): string {
  const copy = describeError(code, { fallback: "read_failed", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

const fieldCls =
  "px-2 py-1.5 text-[12px] bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[var(--color-base)] focus:outline-none focus:border-[var(--color-border-glow)] disabled:opacity-50";
const buttonCls =
  "text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--color-green)] text-[var(--color-green)] disabled:opacity-40 disabled:cursor-default";

/** What the person is told of a save: a cancelled window is not an error. */
function outcomeText(t: ExportText, done: ExportOutcome): Say {
  if (!done.ok) return { ok: false, text: failureText(done.error) };
  if (done.outcome === "cancelled") return { ok: true, text: t.cancelled };
  return { ok: true, text: done.count === undefined ? t.savedNoCount : pluralText(appLocale(), done.count, t.saved) };
}

/**
 * /export: the team's data from jobs.db in a file the person saves where they choose (the native
 * «Save as» window: this page never names a path), and the cloud account's data as one JSON file.
 * Exporting only reads, so it is offered in the read-only view too.
 */
export default function ExportPage(_props: PageProps) {
  const locale = appLocale();
  const t = EXPORT_TEXT[locale];
  const [source, setSource] = useState<ExportSource>("positions");
  const [format, setFormat] = useState<ExportFormat>("json");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [teamSay, setTeamSay] = useState<Say | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountSay, setAccountSay] = useState<Say | null>(null);
  const rangeBad = from !== "" && to !== "" && from > to;

  async function exportTeam() {
    setBusy(true);
    setTeamSay(null);
    const done = await exportTeamData({ source, format, ...(from ? { from } : {}), ...(to ? { to } : {}) });
    setTeamSay(outcomeText(t, done));
    setBusy(false);
  }

  async function exportAccount() {
    setAccountBusy(true);
    setAccountSay(null);
    // the cloud session is loaded only here: a page that never exports does not start it
    const { supabase, supabaseConfigured } = await import("../../lib/supabase");
    const built = await buildAccountExport(supabaseConfigured ? supabase : null);
    if (!built.ok) {
      setAccountSay({
        ok: false,
        text: built.error === "export_incomplete" ? fill(t.accountIncomplete, { tables: built.tables.join(", ") }) : t.accountNotCloud,
      });
    } else {
      setAccountSay(outcomeText(t, await saveAccountExport(built.text)));
    }
    setAccountBusy(false);
  }

  return (
    <section className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4" aria-labelledby="export-title">
      <button
        type="button"
        onClick={() => navigate("/settings")}
        className="self-start text-[11px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)]"
      >
        ← {t.back}
      </button>
      <h1 id="export-title" className="text-[15px] font-semibold text-[var(--color-bright)]">
        {t.title}
      </h1>
      <p className="text-[12px] text-[var(--color-muted)]">{t.intro}</p>

      <section data-testid="export-team" aria-labelledby="export-team-title" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
        <h2 id="export-team-title" className="text-[13px] font-semibold text-[var(--color-bright)]">
          {t.teamTitle}
        </h2>
        <p className="text-[12px] text-[var(--color-muted)]">{t.teamIntro}</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
            {t.source}
            <select className={fieldCls} value={source} disabled={busy} onChange={(event) => setSource(event.target.value as ExportSource)}>
              {EXPORT_SOURCES.map((item) => (
                <option key={item} value={item}>
                  {t[SOURCE_KEY[item]]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
            {t.format}
            <select className={fieldCls} value={format} disabled={busy} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((item) => (
                <option key={item} value={item}>
                  {item.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
            {t.from}
            <input type="date" className={fieldCls} value={from} max={to || undefined} disabled={busy} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
            {t.to}
            <input type="date" className={fieldCls} value={to} min={from || undefined} disabled={busy} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
        <p className="text-[11px] text-[var(--color-muted)]">{t.rangeHint}</p>
        {rangeBad && (
          <p role="alert" data-testid="export-range-bad" className="text-[11px] text-[var(--color-yellow)]">
            {t.rangeInvalid}
          </p>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" data-testid="export-team-button" className={buttonCls} disabled={busy || rangeBad} onClick={() => void exportTeam()}>
            {busy ? t.exporting : t.exportButton}
          </button>
          {teamSay && (
            <p role={teamSay.ok ? "status" : "alert"} data-testid="export-team-say" className="m-0 text-[11px]" style={{ color: teamSay.ok ? "var(--color-green)" : "var(--color-yellow)" }}>
              {teamSay.text}
            </p>
          )}
        </div>
      </section>

      <section data-testid="export-account" aria-labelledby="export-account-title" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
        <h2 id="export-account-title" className="text-[13px] font-semibold text-[var(--color-bright)]">
          {t.accountTitle}
        </h2>
        <p className="text-[12px] text-[var(--color-muted)]">{t.accountIntro}</p>
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" data-testid="export-account-button" className={buttonCls} disabled={accountBusy} onClick={() => void exportAccount()}>
            {accountBusy ? t.exporting : t.accountButton}
          </button>
          {accountSay && (
            <p role={accountSay.ok ? "status" : "alert"} data-testid="export-account-say" className="m-0 text-[11px]" style={{ color: accountSay.ok ? "var(--color-green)" : "var(--color-yellow)" }}>
              {accountSay.text}
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
