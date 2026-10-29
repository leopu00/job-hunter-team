import { useCallback, useEffect, useState } from "react";
import WorkHoursPicker from "@/app/components/WorkHoursPicker";
import { ToastProvider } from "@/app/components/Toast";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import {
  readTeamSettings,
  workingHoursAreValid,
  writeTeamSettings,
  type TeamSettings,
  type WorkingHours,
} from "../../lib/team-settings-native";
import { navigate } from "../../shell/router";
import type { PageProps } from "../types";
import BurstControl from "./BurstControl";
import WorkStatsCard from "./WorkStatsCard";
import { WORK_HOURS_TEXT } from "./work-hours.i18n";

type Loaded = { kind: "loading" } | { kind: "failed"; code: string } | { kind: "ready"; settings: TeamSettings };

function failureText(code: string): string {
  const copy = describeError(code, { fallback: "team_settings_unavailable", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

/**
 * /settings/hours: when the agents work, for the team of this computer or of the linked VPS. The web's
 * own hours picker, as it is, with the native `team_settings` command behind it. The hours are checked
 * here before they are sent: a team whose hours file is malformed works 24/7, so a value off the shape
 * is refused with its reason and never written. A save is the team's: what it answers, read back, is
 * what the page shows.
 */
function WorkHours() {
  const t = WORK_HOURS_TEXT[appLocale()];
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  const load = useCallback(async () => {
    setLoaded({ kind: "loading" });
    const read = await readTeamSettings();
    setLoaded(read.ok ? { kind: "ready", settings: read.settings } : { kind: "failed", code: read.error });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // null when the team took it, else the sentence of the refusal
  const save = useCallback(
    async (next: WorkingHours | null): Promise<string | null> => {
      if (loaded.kind !== "ready") return failureText("team_settings_unavailable");
      if (!workingHoursAreValid(next)) return failureText("team_settings_value_invalid");
      const done = await writeTeamSettings({ workingHours: next }, loaded.settings.connectionKey);
      if (!done.ok) return failureText(done.error);
      setLoaded({ kind: "ready", settings: done.settings });
      return null;
    },
    [loaded],
  );

  return (
    <section className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4" aria-labelledby="work-hours-title">
      <button
        type="button"
        onClick={() => navigate("/settings")}
        className="self-start text-[11px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)]"
      >
        ← {t.back}
      </button>
      <h1 id="work-hours-title" className="text-[15px] font-semibold text-[var(--color-bright)]">
        {t.title}
      </h1>
      {loaded.kind === "loading" && (
        <p role="status" className="text-[12px] text-[var(--color-muted)]">
          {t.loading}
        </p>
      )}
      {loaded.kind === "failed" && (
        <div role="alert" data-testid="work-hours-failed" className="rounded border border-[var(--color-border)] px-4 py-3 text-[12px]">
          <p className="m-0 text-[var(--color-yellow)]">{t.loadFailed}</p>
          <p className="m-0 mt-1 text-[var(--color-muted)]">{failureText(loaded.code)}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)]"
          >
            {t.retry}
          </button>
        </div>
      )}
      {loaded.kind === "ready" && (
        <>
          <p className="text-[12px] text-[var(--color-muted)]" data-testid="work-hours-intro">
            {loaded.settings.target === "vps" ? t.introVps : t.introLocal}
          </p>
          <p className="text-[12px] text-[var(--color-muted)]" data-testid="work-hours-consequence">
            {t.consequence}
          </p>
          <p className="text-[12px] text-[var(--color-yellow)]" data-testid="work-hours-unreadable">
            {t.unreadable}
          </p>
          <BurstControl settings={loaded.settings} onSettings={(next) => setLoaded({ kind: "ready", settings: next })} />
          <WorkHoursPicker
            key={JSON.stringify(loaded.settings.workingHours)}
            cloud={{
              workingHours: loaded.settings.workingHours,
              save,
              sentMessage: t.saved,
              // the picker's note says the preview needs a container; here the preview is not offered yet
              hidePreviewNote: true,
            }}
          />
          <WorkStatsCard target={loaded.settings.target} hours={loaded.settings.workingHours} />
        </>
      )}
    </section>
  );
}

export default function WorkHoursPage(_props: PageProps) {
  return (
    <ToastProvider>
      <WorkHours />
    </ToastProvider>
  );
}
