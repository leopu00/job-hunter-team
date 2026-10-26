import { useCallback, useEffect, useState } from "react";
import { makeT } from "@/lib/i18n-dict";
import WorkHoursPicker from "@/app/components/WorkHoursPicker";
import { ToastProvider, useToast } from "@/app/components/Toast";
import { T as WEB_TEXT } from "@/app/(protected)/settings/team/page.i18n";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { readTeamSettings, writeTeamSettings, type TeamSettings, type TeamSettingsPatch } from "../../lib/team-settings-native";
import { navigate } from "../../shell/router";
import type { PageProps } from "../types";
import RoleModelsCard from "./RoleModelsCard";
import { TEAM_SETTINGS_TEXT } from "./team-settings.i18n";

type Loaded = { kind: "loading" } | { kind: "failed"; code: string } | { kind: "ready"; settings: TeamSettings };

function failureText(code: string): string {
  const copy = describeError(code, { fallback: "team_settings_unavailable", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

/**
 * /settings/team: when the agents work and the model and effort of each role, for the team of this
 * computer or of the linked VPS. The web's own hours picker, as it is, with the native `team_settings`
 * command behind it; the roles are a card of this app (the model is shown as Maximum / Balanced /
 * Economy). A save is the team's: what it answers, read back, is what the page shows.
 */
function TeamSettings() {
  const locale = appLocale();
  const t = TEAM_SETTINGS_TEXT[locale];
  const web = makeT(WEB_TEXT, locale);
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  const load = useCallback(async () => {
    setLoaded({ kind: "loading" });
    const read = await readTeamSettings();
    setLoaded(read.ok ? { kind: "ready", settings: read.settings } : { kind: "failed", code: read.error });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // One write, whole or not at all; null when the team took it, else the sentence of the refusal.
  const save = useCallback(
    async (patch: TeamSettingsPatch): Promise<string | null> => {
      if (loaded.kind !== "ready") return failureText("team_settings_unavailable");
      const done = await writeTeamSettings(patch, loaded.settings.connectionKey);
      if (!done.ok) return failureText(done.error);
      setLoaded({ kind: "ready", settings: done.settings });
      // the hours picker says its own «saved»: only the roles are told here
      if (patch.roleModels !== undefined) toast(t.saved, "success");
      return null;
    },
    [loaded, t.saved, toast],
  );

  return (
    <section className="max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4" aria-labelledby="team-settings-title">
      <button
        type="button"
        onClick={() => navigate("/settings")}
        className="self-start text-[11px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)]"
      >
        ← {t.back}
      </button>
      <h1 id="team-settings-title" className="text-[15px] font-semibold text-[var(--color-bright)]">
        {t.title}
      </h1>
      {loaded.kind === "loading" && (
        <p role="status" className="text-[12px] text-[var(--color-muted)]">
          {t.loading}
        </p>
      )}
      {loaded.kind === "failed" && (
        <div role="alert" data-testid="team-settings-failed" className="rounded border border-[var(--color-border)] px-4 py-3 text-[12px]">
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
          <p className="text-[12px] text-[var(--color-muted)]" data-testid="team-settings-intro">
            {loaded.settings.target === "vps" ? t.introVps : t.introLocal}
          </p>
          <WorkHoursPicker
            cloud={{
              workingHours: loaded.settings.workingHours,
              save: (next) => save({ workingHours: next }),
              sentMessage: t.saved,
              // the picker's note says the preview needs a container; here the preview is not offered yet
              hidePreviewNote: true,
            }}
          />
          {/* mounted again with what the team answered, so the form always shows the values read back */}
          <RoleModelsCard
            key={JSON.stringify([loaded.settings.roleModels, loaded.settings.effective])}
            saved={loaded.settings.roleModels}
            effective={loaded.settings.effective}
            classApplies={loaded.settings.classApplies}
            onSave={(roleModels) => save({ roleModels })}
            text={t}
            web={web}
          />
        </>
      )}
    </section>
  );
}

export default function TeamSettingsPage(_props: PageProps) {
  return (
    <ToastProvider>
      <TeamSettings />
    </ToastProvider>
  );
}
