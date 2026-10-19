import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProfileLoading from "@/app/(protected)/profile/loading";
import ProfileView, { type ProfileExportLink } from "@/app/(protected)/profile/ProfileView";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import {
  buildProfileView,
  missingCoreFields,
  readExistingTeamProfile,
  type ExistingTeamProfileRead,
  type ExistingTeamProfileReading,
  type ExistingTeamProfileView,
  type SummaryState,
} from "../../lib/existing-team-profile";
import { existingTeamReadOnlyReason, useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { EXISTING_TEAM_PROFILE_TEXT, type ExistingTeamProfileText } from "./existing-team-profile.i18n";

const YAML_MAX = 65536;

function stamp(at: number): string {
  return new Date(at).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "medium" });
}

type Built = { view: ExistingTeamProfileView | null; mapFailed: boolean };

function build(read: ExistingTeamProfileRead): Built {
  try {
    return { view: buildProfileView(read), mapFailed: false };
  } catch {
    return { view: null, mapFailed: true };
  }
}

const SUMMARY_REASON: Record<Exclude<SummaryState, "ok" | "absent">, keyof ExistingTeamProfileText> = {
  too_large: "summaryTooLarge",
  unreadable: "summaryUnreadable",
  not_utf8: "summaryNotText",
  over_budget: "summaryOverBudget",
};

/** Everything the core could not read, cut or leave out, said one by one. */
function notices(read: ExistingTeamProfileRead, built: Built, t: ExistingTeamProfileText): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  const { file, summaries } = read;
  if (file.state === "absent") out.push({ id: "file-absent", text: t.fileAbsent });
  if (file.state === "too_large") {
    out.push({
      id: "file-too-large",
      text: t.fileTooLarge.replace("{bytes}", String(file.bytes ?? "?")).replace("{max}", String(YAML_MAX)),
    });
  }
  if (file.state === "unreadable") out.push({ id: "file-unreadable", text: t.fileUnreadable });
  if (file.state === "not_utf8") out.push({ id: "file-not-text", text: t.fileNotText });
  if (file.parse === "invalid_yaml") out.push({ id: "parse-invalid", text: t.parseInvalid });
  if (file.parse === "not_a_mapping") out.push({ id: "parse-not-mapping", text: t.parseNotMapping });
  if (file.parse === "aliases_unsupported") out.push({ id: "parse-aliases", text: t.parseAliases });
  if (built.mapFailed) out.push({ id: "map-failed", text: t.mapFailed.replace("{code}", "profile_not_interpretable") });
  if (file.fields) {
    if (file.dropped > 0) out.push({ id: "dropped", text: t.dropped.replace("{n}", String(file.dropped)) });
    const missing = missingCoreFields(file.fields);
    if (missing.length > 0) out.push({ id: "missing-core", text: t.missingCore.replace("{list}", missing.join(", ")) });
  }
  if (summaries.state === "unreadable") out.push({ id: "summaries-unreadable", text: t.summariesUnreadable });
  for (const item of summaries.items) {
    if (item.state === "ok") continue;
    const reason = t[SUMMARY_REASON[item.state as Exclude<SummaryState, "ok" | "absent">]];
    out.push({ id: `summary-${item.name}`, text: t.summaryNotRead.replace("{name}", item.name).replace("{reason}", reason) });
  }
  if (summaries.included < summaries.of) {
    out.push({
      id: "summaries-cut",
      text: t.summariesCut.replace("{included}", String(summaries.included)).replace("{of}", String(summaries.of)),
    });
  }
  return out;
}

/**
 * «Profilo» of an existing team that is only read: the candidate profile the
 * team's VPS holds, drawn by the same ProfileView the web draws, from the
 * fields the core's `profile` op returns. Editing is shown disabled with the
 * reason, nothing is downloaded but the profile data on screen, and whatever
 * the core could not read, cut or leave out is told, one thing at a time.
 */
export default function ExistingTeamProfilePage(_props: PageProps) {
  const t = EXISTING_TEAM_PROFILE_TEXT[appLocale()];
  const readOnly = useExistingTeamReadOnly();
  const [reading, setReading] = useState<ExistingTeamProfileReading>({ kind: "unknown" });
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const read = useCallback(async () => {
    const mine = ++latest.current;
    setBusy(true);
    const result = await readExistingTeamProfile();
    // A read that finished after a newer one started, or after leaving the page, is not shown.
    if (latest.current !== mine) return;
    setReading(result);
    setBusy(false);
  }, []);

  useEffect(() => {
    void read();
    return () => {
      latest.current++;
    };
  }, [read]);
  useRefresh(() => void read());

  const built = useMemo<Built | null>(() => (reading.kind === "read" ? build(reading.read) : null), [reading]);
  const profile = built?.view?.profile ?? null;
  const exportLink = useMemo<ProfileExportLink | undefined>(() => {
    if (!profile || typeof URL.createObjectURL !== "function") return undefined;
    const json = JSON.stringify(profile, null, 2);
    return {
      href: URL.createObjectURL(new Blob([json], { type: "application/json" })),
      fileName: `profilo-candidato-${new Date().toISOString().slice(0, 10)}.json`,
    };
  }, [profile]);
  useEffect(
    () => () => {
      if (exportLink && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(exportLink.href);
    },
    [exportLink],
  );

  const failure =
    reading.kind === "error"
      ? describeError(reading.code, { fallback: "existing_team_unavailable", locale: appLocale() })
      : null;
  const reason = readOnly ? existingTeamReadOnlyReason(readOnly) : "";

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* No px-5 here: MainChrome already pads the page (max-w-6xl px-5); a second one put this block one margin to the right of the cards below. */}
      <div className="max-w-6xl mx-auto pt-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            {reading.kind === "read" && (
              <p data-testid="profile-time" className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                {(busy ? t.staleWhileReading : t.readAt).replace("{time}", stamp(reading.at))}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              title={reason}
              data-testid="profile-edit"
              className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] opacity-60 cursor-not-allowed"
            >
              {t.edit}
            </button>
            <button
              type="button"
              onClick={() => void read()}
              disabled={busy}
              className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-60 disabled:cursor-wait"
            >
              {busy ? t.refreshing : t.refresh}
            </button>
          </div>
        </div>
        <p data-testid="profile-edit-reason" className="text-[11px] mb-2" style={{ color: "var(--color-muted)" }}>
          {reason}
        </p>
        <p data-testid="profile-limits" className="text-[11px] mb-3" style={{ color: "var(--color-muted)" }}>
          {t.limits}
        </p>

        {reading.kind === "unknown" && !busy && (
          <p data-testid="profile-unknown" className="text-[12px]" style={{ color: "var(--color-muted)" }}>
            {t.unknown}
          </p>
        )}

        {reading.kind === "error" && failure && (
          <div role="alert" data-testid="profile-error" className="text-[12px]" style={{ color: "var(--color-red)" }}>
            <strong>{t.failed}</strong>
            <p>
              {failure.text} {failure.action} ({reading.code})
            </p>
            <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
              {t.failedAt.replace("{time}", stamp(reading.at))}
            </p>
          </div>
        )}

        {reading.kind === "read" && built && (
          <ul data-testid="profile-notices" className="flex flex-col gap-1 mb-2">
            {notices(reading.read, built, t).map((notice) => (
              <li
                key={notice.id}
                data-testid={`profile-notice-${notice.id}`}
                className="text-[11px]"
                style={{ color: "var(--color-yellow)" }}
              >
                {notice.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {reading.kind === "unknown" && busy && <ProfileLoading />}

      {reading.kind === "read" && built?.view && (
        <div data-testid="profile-view" aria-busy={busy} style={{ opacity: busy ? 0.55 : 1 }}>
          <ProfileView
            profile={built.view.profile}
            blocks={built.view.blocks}
            cloudContacts={built.view.contacts}
            locale={appLocale()}
            canEdit={false}
            exportLink={exportLink}
          />
        </div>
      )}
    </div>
  );
}
