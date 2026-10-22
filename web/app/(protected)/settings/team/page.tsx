"use client";

// Working hours and the model and effort of each role, asked from the site.
//
// The site never writes the box's config: each save asks the door
// (POST /api/team/settings, `settings.update`), the database keeps the desire
// in team_state, and the paired computer applies it and says when. The page
// shows that state («waiting» or «applied on …») from GET /api/team-state.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import { makeT } from "@/lib/i18n-dict";
import WorkHoursPicker from "@/app/components/WorkHoursPicker";
import {
  loadDesired,
  refusalKey,
  saveTeamSettings,
  settingsStatus,
  type DesiredSettings,
  type RoleModels,
  type WorkingHours,
} from "@/lib/team-settings";
import RoleModelsPanel from "./RoleModelsPanel";
import { T } from "./page.i18n";

// After a save the page follows the status for a while, then stops: one read
// every 15 s for 5 minutes, not a poll for as long as the tab stays open.
const FOLLOW_MS = 15_000;
const FOLLOW_MAX = 20;

export default function TeamSettingsPage() {
  const locale = useLocale();
  const tr = makeT(T, locale);
  const isCloud = useIsCloud();
  const [desired, setDesired] = useState<DesiredSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const follow = useRef<{ timer: number | null; left: number }>({
    timer: null,
    left: 0,
  });

  const reload = useCallback(async () => {
    const next = await loadDesired();
    if (next) {
      setDesired(next);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    return next;
  }, []);

  const stopFollowing = useCallback(() => {
    if (follow.current.timer !== null)
      window.clearTimeout(follow.current.timer);
    follow.current = { timer: null, left: 0 };
  }, []);

  const startFollowing = useCallback(() => {
    stopFollowing();
    follow.current.left = FOLLOW_MAX;
    const tick = async () => {
      follow.current.left -= 1;
      const next = await reload();
      if (
        follow.current.left > 0 &&
        (!next || settingsStatus(next.desiredAt, next.appliedAt) === "pending")
      ) {
        follow.current.timer = window.setTimeout(() => void tick(), FOLLOW_MS);
      } else {
        follow.current.timer = null;
      }
    };
    follow.current.timer = window.setTimeout(() => void tick(), FOLLOW_MS);
  }, [reload, stopFollowing]);

  useEffect(() => {
    if (isCloud !== true) return;
    void reload();
    return stopFollowing;
  }, [isCloud, reload, stopFollowing]);

  const refusalText = (code: string) => tr(`err_${refusalKey(code)}`);

  const save = useCallback(
    async (
      params:
        | { working_hours: WorkingHours | null }
        | { role_models: RoleModels },
    ): Promise<string | null> => {
      const result = await saveTeamSettings(params);
      if (!result.ok) return refusalText(result.code);
      await reload();
      startFollowing();
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reload, startFollowing, locale],
  );

  const card =
    "border border-[var(--color-border)] bg-[var(--color-panel)] rounded-lg p-4";
  const status = desired
    ? settingsStatus(desired.desiredAt, desired.appliedAt)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/settings"
        className="text-[10px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)] no-underline transition-colors"
      >
        ← {tr("breadcrumb")}
      </Link>
      <h1 className="text-[20px] font-bold tracking-[0.08em] uppercase text-[var(--color-bright)] mt-2 mb-1">
        {tr("title")}
      </h1>
      <p className="text-[11.5px] text-[var(--color-muted)] m-0 mb-6">
        {tr("subtitle")}
      </p>

      {isCloud === false && (
        <div className={`${card} text-[11.5px] text-[var(--color-muted)]`}>
          {tr("cloud_only")}
        </div>
      )}

      {isCloud === true && !desired && (
        <div
          role={loadFailed ? "alert" : "status"}
          className={`${card} text-[11.5px] ${loadFailed ? "text-[var(--color-yellow)]" : "text-[var(--color-muted)]"}`}
        >
          {loadFailed ? tr("load_error") : tr("loading")}
        </div>
      )}

      {isCloud === true && desired && (
        <div className="flex flex-col gap-4">
          <div
            role="status"
            aria-live="polite"
            className={`${card} text-[11.5px] ${status === "pending" ? "text-[var(--color-yellow)]" : status === "applied" ? "text-[var(--color-green)]" : "text-[var(--color-muted)]"}`}
          >
            {status === "applied" && desired.appliedAt
              ? tr("status_applied").replace(
                  "{when}",
                  new Date(desired.appliedAt).toLocaleString(locale),
                )
              : status === "pending"
                ? tr("status_pending")
                : tr("status_none")}
          </div>

          <WorkHoursPicker
            cloud={{
              workingHours: desired.workingHours,
              save: (next) => save({ working_hours: next }),
              sentMessage: tr("saved"),
            }}
          />

          <RoleModelsPanel
            saved={desired.roleModels}
            onSave={(roleModels) => save({ role_models: roleModels })}
            t={tr}
          />
        </div>
      )}
    </div>
  );
}
