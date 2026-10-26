import { useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { useTeamOff, type TeamOff } from "../../lib/team-off";
import { teamOffFailure } from "../../shell/team-off-failure";
import { pluralText } from "../../lib/plural";
import { fill } from "../../lib/text-slots";
import {
  backupCancel,
  backupCreate,
  backupInspect,
  onBackupProgress,
  type BackupInspectOutcome,
  type BackupPhase,
  type BackupProgress,
} from "../../lib/team-backup";
import { navigate } from "../../shell/router";
import type { PageProps } from "../types";
import { BACKUP_TEXT, type BackupText } from "./backup.i18n";

const PHASE_KEY = {
  plan: "phasePlan",
  snapshot: "phaseSnapshot",
  copy: "phaseCopy",
  verify: "phaseVerify",
} as const satisfies Record<BackupPhase, keyof BackupText>;

type Say = { ok: boolean; text: string };
type Opened = Extract<BackupInspectOutcome, { outcome: "opened" }>;

function failureText(code: string, teamOff: TeamOff | null = null): string {
  const needsRuntime = teamOffFailure(code, teamOff, appLocale());
  if (needsRuntime) return needsRuntime;
  const copy = describeError(code, { fallback: "backup_save_failed", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

/** 1536 → «1.5 KB»: the biggest unit that keeps the number above 1. */
export function sizeText(bytes: number, locale = appLocale()): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, { style: "unit", unit: units[unit], unitDisplay: "short", maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
}

const buttonCls =
  "text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--color-green)] text-[var(--color-green)] disabled:opacity-40 disabled:cursor-default";
const secondaryCls =
  "text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-bright)] disabled:opacity-40 disabled:cursor-default";

/**
 * /backup: a copy of what the person owns in the team, saved where they choose in the system's «Save
 * as» window (this page never names a path), and a check of a backup file. The page says, before
 * anything is saved, that the file is not encrypted and holds personal data. Making a backup only
 * reads the team, so it is offered in the read-only view too. There is no restore in this version.
 */
export default function BackupPage(_props: PageProps) {
  const teamOff = useTeamOff();
  const locale = appLocale();
  const t = BACKUP_TEXT[locale];
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [createSay, setCreateSay] = useState<Say | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [inspectSay, setInspectSay] = useState<Say | null>(null);

  // the progress of the backup that runs, only while this page is open
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void onBackupProgress((next) => live && setProgress(next)).then((off) => {
      if (live) stop = off;
      else off();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  async function create() {
    setRunning(true);
    setCancelling(false);
    setProgress(null);
    setCreateSay(null);
    const done = await backupCreate();
    // a closed window is not an error: nothing to say
    if (!done.ok) setCreateSay({ ok: false, text: failureText(done.error, teamOff) });
    else if (done.outcome === "saved") setCreateSay({ ok: true, text: pluralText(locale, done.files, t.saved, { size: sizeText(done.bytes, locale) }) });
    setRunning(false);
    setProgress(null);
  }

  async function cancel() {
    setCancelling(true);
    await backupCancel();
  }

  async function inspect() {
    setInspecting(true);
    setInspectSay(null);
    const done = await backupInspect();
    if (!done.ok) {
      setOpened(null);
      setInspectSay({ ok: false, text: failureText(done.error, teamOff) });
    } else if (done.outcome === "opened") {
      setOpened(done);
    }
    setInspecting(false);
  }

  const showBar = progress?.phase === "copy" && progress.total > 0;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const manifest = opened?.manifest;
  const total = manifest ? manifest.files.reduce((sum, file) => sum + file.bytes, 0) : 0;

  return (
    <section className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4" aria-labelledby="backup-title">
      <button
        type="button"
        onClick={() => navigate("/settings")}
        className="self-start text-[11px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)]"
      >
        ← {t.back}
      </button>
      <h1 id="backup-title" className="text-[15px] font-semibold text-[var(--color-bright)]">
        {t.title}
      </h1>
      <p className="text-[12px] text-[var(--color-muted)]">{t.intro}</p>
      {/* said before anything is saved: the file is plain and holds the person's data */}
      <p role="note" data-testid="backup-personal-data" className="text-[12px] text-[var(--color-yellow)]">
        {t.warning}
      </p>

      <section data-testid="backup-create" aria-labelledby="backup-create-title" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
        <h2 id="backup-create-title" className="text-[13px] font-semibold text-[var(--color-bright)]">
          {t.createTitle}
        </h2>
        <p className="text-[12px] text-[var(--color-muted)]">{t.createText}</p>
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" data-testid="backup-create-button" className={buttonCls} disabled={running} onClick={() => void create()}>
            {running ? t.working : t.createButton}
          </button>
          {running && (
            <button type="button" data-testid="backup-cancel-button" className={secondaryCls} disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? t.cancelling : t.cancelButton}
            </button>
          )}
        </div>
        {running && progress && (
          <div data-testid="backup-progress" className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-bright)]">
              {t[PHASE_KEY[progress.phase]]}
              {showBar && ` · ${sizeText(progress.done, locale)} / ${sizeText(progress.total, locale)}`}
            </span>
            {/* sizes and bar only while files are copied: the other phases have a total but no count of their own, and a bar stuck at zero looks like a block */}
            {showBar && percent !== null && <progress aria-label={t[PHASE_KEY[progress.phase]]} max={100} value={percent} className="w-full" />}
          </div>
        )}
        {createSay && (
          <p role={createSay.ok ? "status" : "alert"} data-testid="backup-create-say" className="m-0 text-[11px]" style={{ color: createSay.ok ? "var(--color-green)" : "var(--color-yellow)" }}>
            {createSay.text}
          </p>
        )}
      </section>

      <section data-testid="backup-inspect" aria-labelledby="backup-inspect-title" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-3">
        <h2 id="backup-inspect-title" className="text-[13px] font-semibold text-[var(--color-bright)]">
          {t.inspectTitle}
        </h2>
        <p className="text-[12px] text-[var(--color-muted)]">{t.inspectText}</p>
        <div>
          <button type="button" data-testid="backup-inspect-button" className={secondaryCls} disabled={inspecting} onClick={() => void inspect()}>
            {inspecting ? t.inspecting : t.inspectButton}
          </button>
        </div>
        {inspectSay && (
          <p role="alert" data-testid="backup-inspect-say" className="m-0 text-[11px] text-[var(--color-yellow)]">
            {inspectSay.text}
          </p>
        )}
        {opened && manifest && (
          <div data-testid="backup-opened" className="flex flex-col gap-1 text-[12px] text-[var(--color-bright)]">
            <p data-testid="backup-verified" role="status" className="m-0" style={{ color: opened.verified ? "var(--color-green)" : "var(--color-yellow)" }}>
              {opened.verified ? t.verifiedYes : t.verifiedNo}
            </p>
            {manifest.createdAt && !Number.isNaN(Date.parse(manifest.createdAt)) && (
              <p className="m-0 text-[var(--color-muted)]">{fill(t.createdAt, { date: new Date(manifest.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })}</p>
            )}
            <p className="m-0 text-[var(--color-muted)]">{pluralText(locale, manifest.files.length, t.filesLine, { size: sizeText(total, locale) })}</p>
            {manifest.excluded.length > 0 && <p className="m-0 text-[var(--color-muted)]">{pluralText(locale, manifest.excluded.length, t.excludedLine)}</p>}
            {opened.problems.length > 0 && (
              <div data-testid="backup-problems" role="alert">
                <p className="m-0 text-[var(--color-yellow)]">{t.problems}</p>
                <ul className="m-0 pl-4 list-disc text-[11px] text-[var(--color-muted)]">
                  {opened.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
            {manifest.alwaysExcluded.length > 0 && (
              <p data-testid="backup-always-excluded" className="m-0 text-[11px] text-[var(--color-muted)]">
                {fill(t.alwaysExcluded, { names: manifest.alwaysExcluded.join(", ") })}
              </p>
            )}
          </div>
        )}
      </section>
      <p className="text-[11px] text-[var(--color-muted)]">{t.noRestore}</p>
    </section>
  );
}
