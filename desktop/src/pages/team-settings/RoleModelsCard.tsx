import { useState } from "react";
import { EFFORTS, MODEL_CLASSES, SETTINGS_ROLES, roleModelsChanged, roleModelsToSend, type Effort, type ModelClass, type RoleModels, type SettingsRole } from "@/lib/team-settings";
import type { TeamSettingsText } from "./team-settings.i18n";

const selectCls =
  "w-full px-2 py-1.5 text-[11.5px] bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[var(--color-base)] focus:outline-none focus:border-[var(--color-border-glow)] disabled:opacity-50";

const CLASS_KEY = { sol: "classSol", terra: "classTerra", luna: "classLuna" } as const satisfies Record<ModelClass, keyof TeamSettingsText>;

/**
 * The model class and the effort of each role, as the team holds them. «Default» leaves the role
 * to the team. A role is sent only when it changed (the team merges role by role), and what the
 * team answers replaces the form: the parent mounts it again with the values read back.
 */
export default function RoleModelsCard({
  saved,
  onSave,
  text,
  web,
}: {
  saved: RoleModels;
  /** Null when the team took it, else the sentence of the refusal. */
  onSave: (roleModels: RoleModels) => Promise<string | null>;
  text: TeamSettingsText;
  /** The web page's words: role and effort names, «Default», the buttons. */
  web: (key: string) => string;
}) {
  const [edited, setEdited] = useState<RoleModels>(saved);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = roleModelsChanged(saved, edited);

  function setRole(role: SettingsRole, patch: { model?: string; effort?: string }) {
    setProblem(null);
    setEdited((prev) => {
      const entry = { ...(prev[role] ?? {}) };
      if ("model" in patch) {
        if (patch.model) entry.model = patch.model as ModelClass;
        else delete entry.model;
      }
      if ("effort" in patch) {
        if (patch.effort) entry.effort = patch.effort as Effort;
        else delete entry.effort;
      }
      return { ...prev, [role]: entry };
    });
  }

  async function save() {
    setBusy(true);
    setProblem(await onSave(roleModelsToSend(saved, edited)));
    setBusy(false);
  }

  return (
    <section data-testid="team-settings-models" className="border border-[var(--color-border)] bg-[var(--color-panel)] rounded-lg p-4">
      <h2 className="text-[12px] font-bold tracking-[0.1em] uppercase text-[var(--color-bright)] m-0 mb-1">{text.modelsTitle}</h2>
      <p className="text-[11px] text-[var(--color-muted)] m-0 mb-4">{text.modelsDesc}</p>
      <div role="table" aria-label={text.modelsTitle} className="flex flex-col gap-2">
        <div role="row" className="grid grid-cols-[1fr_1fr_1fr] gap-3 text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--color-dim)]">
          <span role="columnheader">{web("col_role")}</span>
          <span role="columnheader">{web("col_model")}</span>
          <span role="columnheader">{web("col_effort")}</span>
        </div>
        {SETTINGS_ROLES.map((role) => {
          const entry = edited[role] ?? {};
          const label = web(`role_${role}`);
          return (
            <div key={role} role="row" className="grid grid-cols-[1fr_1fr_1fr] gap-3 items-center">
              <span role="rowheader" className="text-[12px] text-[var(--color-bright)]">
                {label}
              </span>
              <select
                className={selectCls}
                aria-label={`${label}: ${web("col_model")}`}
                value={entry.model ?? ""}
                disabled={busy}
                onChange={(event) => setRole(role, { model: event.target.value })}
              >
                <option value="">{web("opt_default")}</option>
                {MODEL_CLASSES.map((model) => (
                  <option key={model} value={model}>
                    {text[CLASS_KEY[model]]}
                  </option>
                ))}
              </select>
              <select
                className={selectCls}
                aria-label={`${label}: ${web("col_effort")}`}
                value={entry.effort ?? ""}
                disabled={busy}
                onChange={(event) => setRole(role, { effort: event.target.value })}
              >
                <option value="">{web("opt_default")}</option>
                {EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {web(`effort_${effort}`)}
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
          data-testid="team-settings-models-save"
          onClick={() => void save()}
          disabled={!dirty || busy}
          className="px-4 py-1.5 text-[11px] font-semibold rounded border border-[var(--color-green)] text-[var(--color-green)] hover:bg-[var(--color-card)] disabled:opacity-40 disabled:cursor-default"
        >
          {busy ? web("saving") : web("save")}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            onClick={() => {
              setEdited(saved);
              setProblem(null);
            }}
            className="px-3 py-1.5 text-[11px] rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
          >
            {web("discard")}
          </button>
        )}
        {problem && (
          <p role="alert" data-testid="team-settings-models-problem" className="m-0 text-[11px] text-[var(--color-yellow)]">
            {problem}
          </p>
        )}
      </div>
    </section>
  );
}
