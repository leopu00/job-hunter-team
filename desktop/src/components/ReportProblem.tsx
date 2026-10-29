import { useState } from "react";
import { appLocale } from "../lib/app-locale";
import {
  PROBLEM_CATEGORIES, PROBLEM_MAX_CHARS, PROBLEM_MIN_CHARS, createProblemReport, deliverSetupSupportReport,
  operatingSystem, readSetupSupportContext, type ProblemCategory, type SetupSupportReport,
} from "../lib/onboarding-support";
import { SUPPORT_REPORT_COPY } from "../onboarding/SetupSupportReport";
import { REPORT_PROBLEM_TEXT, type ReportProblemText } from "./report-problem.i18n";

const CATEGORY_KEY: Record<ProblemCategory, keyof ReportProblemText> = {
  install: "categoryInstall", team: "categoryTeam", account: "categoryAccount", other: "categoryOther",
};

/**
 * «Report a problem», from Help and from Settings. The person writes what happened and picks a category;
 * the app shows the redacted text (what they wrote, the app version, the system and the last lines of the
 * runtime log) and sends it only when they press «Send». The same intake and the same redaction as the
 * setup's report (lib/onboarding-support.ts): the preview is the text that leaves.
 */
export default function ReportProblem({ id }: { id: string }) {
  const locale = appLocale();
  const t = REPORT_PROBLEM_TEXT[locale];
  const status = SUPPORT_REPORT_COPY[locale];
  const [category, setCategory] = useState<ProblemCategory>("other");
  const [description, setDescription] = useState("");
  const [report, setReport] = useState<SetupSupportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ message: string; href?: string; saved?: string | null } | null>(null);
  const ready = description.trim().length >= PROBLEM_MIN_CHARS;

  async function prepare() {
    setBusy(true); setOutcome(null);
    try {
      const context = await readSetupSupportContext();
      setReport(createProblemReport({
        category, description, locale, appVersion: context.appVersion, platform: operatingSystem(), logTail: context.logTail,
      }));
    } catch { setOutcome({ message: status.failed }); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!report) return;
    setBusy(true);
    const next = await deliverSetupSupportReport(report);
    setBusy(false);
    if (next.kind === "sent") { setOutcome({ message: `${status.sent}: ${next.ticket}` }); setReport(null); setDescription(""); return; }
    if (next.kind === "mailto") {
      // the person already confirmed: hand the prepared message to their mail app without a second click
      window.location.assign(next.href);
      setOutcome({ message: status.mail, saved: next.savedReport }); setReport(null); return;
    }
    setOutcome({ message: status.failed });
  }

  const card = "rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2";
  const field = "w-full rounded border border-[var(--color-border)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--color-bright)]";
  const button = "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-50";

  return (
    <section data-testid="report-problem" aria-labelledby={`${id}-title`} className={card}>
      <h2 id={`${id}-title`} className="text-[13px] font-semibold text-[var(--color-bright)]">{t.reportTitle}</h2>
      <p className="text-[12px] text-[var(--color-muted)]">{t.reportIntro}</p>
      <p className="text-[12px] text-[var(--color-muted)]" data-testid="report-problem-note">{t.reportNote}</p>
      {report ? (
        <>
          <label className="text-[11px] text-[var(--color-muted)] flex flex-col gap-1">
            {status.preview}
            <textarea readOnly value={report.preview} aria-label={status.preview} rows={12} className={`${field} font-mono`} data-testid="report-problem-preview" />
          </label>
          <div className="flex gap-2">
            <button type="button" className={button} disabled={busy} onClick={() => setReport(null)}>{status.cancel}</button>
            <button type="button" className={button} disabled={busy} data-testid="report-problem-send" onClick={() => void send()}>{busy ? status.sending : t.reportSend}</button>
          </div>
        </>
      ) : (
        <>
          <fieldset className="flex flex-col gap-1 border-0 p-0 m-0" data-testid="report-problem-category">
            <legend className="text-[11px] text-[var(--color-muted)] mb-1">{t.reportCategoryLabel}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {PROBLEM_CATEGORIES.map((value) => (
                <label key={value} className="flex items-center gap-1.5 text-[12px] text-[var(--color-bright)]">
                  <input type="radio" name={`${id}-category`} value={value} checked={category === value} onChange={() => setCategory(value)} />
                  {t[CATEGORY_KEY[value]]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-[11px] text-[var(--color-muted)] flex flex-col gap-1">
            {t.reportFieldLabel}
            <textarea className={field} rows={5} maxLength={PROBLEM_MAX_CHARS} value={description} onChange={(event) => setDescription(event.target.value)} data-testid="report-problem-description" />
          </label>
          {outcome && <p role="status" className="text-[11px] text-[var(--color-muted)]">{outcome.message} {outcome.saved && <span>{status.saved}: <code>{outcome.saved}</code></span>}</p>}
          <div>
            <button type="button" className={button} disabled={busy || !ready} data-testid="report-problem-preview-button" onClick={() => void prepare()}>{busy ? status.preparing : t.reportShowPreview}</button>
          </div>
        </>
      )}
    </section>
  );
}
