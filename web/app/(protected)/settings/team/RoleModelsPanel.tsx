"use client";

import { useEffect, useState } from "react";
import {
  EFFORTS,
  MODEL_CLASSES,
  SETTINGS_ROLES,
  roleModelsChanged,
  roleModelsToSend,
  type Effort,
  type ModelClass,
  type RoleModels,
  type SettingsRole,
} from "@/lib/team-settings";

const selectCls =
  "w-full px-2 py-1.5 text-[11.5px] bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[var(--color-base)] focus:outline-none focus:border-[var(--color-border-glow)] disabled:opacity-50";

/**
 * Model class and effort of each role, as the site asked them last.
 *
 * «Default» leaves the role to the team's map. Only the roles changed here are
 * sent as changed; the ones the site set before are sent again as they are, so
 * a role set on the desktop and never touched here stays (the box merges role
 * by role).
 */
export default function RoleModelsPanel({
  saved,
  onSave,
  t,
}: {
  saved: RoleModels;
  /** Asks the door: null when it took the request, else the sentence of the refusal. */
  onSave: (roleModels: RoleModels) => Promise<string | null>;
  t: (key: string) => string;
}) {
  const [edited, setEdited] = useState<RoleModels>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const dirty = roleModelsChanged(saved, edited);

  // A new version from the database replaces the form only while nothing is being edited.
  useEffect(() => {
    if (!dirty) setEdited(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  function setRole(
    role: SettingsRole,
    patch: { model?: string; effort?: string },
  ) {
    setMessage(null);
    setEdited((prev) => {
      const next: RoleModels = { ...prev };
      const entry = { ...(prev[role] ?? {}) };
      if ("model" in patch) {
        if (patch.model) entry.model = patch.model as ModelClass;
        else delete entry.model;
      }
      if ("effort" in patch) {
        if (patch.effort) entry.effort = patch.effort as Effort;
        else delete entry.effort;
      }
      next[role] = entry;
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const refusal = await onSave(roleModelsToSend(saved, edited));
    setMessage(
      refusal === null
        ? { ok: true, text: t("saved") }
        : { ok: false, text: refusal },
    );
    setBusy(false);
  }

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-panel)] rounded-lg p-4">
      <h2 className="text-[12px] font-bold tracking-[0.1em] uppercase text-[var(--color-bright)] m-0 mb-1">
        {t("models_title")}
      </h2>
      <p className="text-[10.5px] text-[var(--color-muted)] m-0 mb-4">
        {t("models_desc")}
      </p>

      <div
        role="table"
        aria-label={t("models_title")}
        className="flex flex-col gap-2"
      >
        <div
          role="row"
          className="grid grid-cols-[1fr_1fr_1fr] gap-3 text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--color-dim)]"
        >
          <span role="columnheader">{t("col_role")}</span>
          <span role="columnheader">{t("col_model")}</span>
          <span role="columnheader">{t("col_effort")}</span>
        </div>
        {SETTINGS_ROLES.map((role) => {
          const entry = edited[role] ?? {};
          const label = t(`role_${role}`);
          return (
            <div
              key={role}
              role="row"
              className="grid grid-cols-[1fr_1fr_1fr] gap-3 items-center"
            >
              <span
                role="rowheader"
                className="text-[12px] text-[var(--color-bright)]"
              >
                {label}
              </span>
              <select
                className={selectCls}
                aria-label={`${label}: ${t("col_model")}`}
                value={entry.model ?? ""}
                disabled={busy}
                onChange={(e) => setRole(role, { model: e.target.value })}
              >
                <option value="">{t("opt_default")}</option>
                {MODEL_CLASSES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className={selectCls}
                aria-label={`${label}: ${t("col_effort")}`}
                value={entry.effort ?? ""}
                disabled={busy}
                onChange={(e) => setRole(role, { effort: e.target.value })}
              >
                <option value="">{t("opt_default")}</option>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {t(`effort_${e}`)}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap mt-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || busy}
          className="px-4 py-1.5 text-[11px] font-semibold rounded border border-[var(--color-green)] text-[var(--color-green)] hover:bg-[var(--color-card)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          {busy ? t("saving") : t("save")}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            onClick={() => {
              setEdited(saved);
              setMessage(null);
            }}
            className="px-3 py-1.5 text-[10.5px] rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors cursor-pointer bg-transparent"
          >
            {t("discard")}
          </button>
        )}
        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={`m-0 text-[10.5px] ${message.ok ? "text-[var(--color-green)]" : "text-[var(--color-yellow)]"}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
