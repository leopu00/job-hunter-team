"use client";

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { CronJobCreateInput, ScheduleKind } from "./types";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./CronForm.i18n";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

const inputCls =
  "w-full px-3 py-2 rounded text-[12px] font-mono bg-[var(--color-card)] border border-[var(--color-border)] outline-none focus:border-[var(--color-green)] transition-colors";

export function CronForm({ onCreated, onCancel }: Props) {
  const locale = useLocale();
  const tr = makeT(T, locale);

  const SCHEDULE_KINDS: { value: ScheduleKind; label: string }[] = [
    { value: "cron", label: tr("kind_cron") },
    { value: "every", label: tr("kind_every") },
    { value: "at", label: tr("kind_at") },
  ];
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [command, setCommand] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("cron");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1-5");
  const [everyMin, setEveryMin] = useState("30");
  const [atWhen, setAtWhen] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const buildSchedule = () => {
    if (kind === "cron")
      return { kind: "cron" as const, expr: cronExpr.trim() };
    if (kind === "every")
      return { kind: "every" as const, everyMs: Number(everyMin) * 60_000 };
    return { kind: "at" as const, at: atWhen.trim() };
  };

  const validate = (): string | undefined => {
    if (!name.trim()) return tr("err_name_required");
    if (!command.trim()) return tr("err_command_required");
    if (/[\n\r\0]/.test(command)) return tr("err_command_invalid");
    if (kind === "cron" && !cronExpr.trim()) return tr("err_cron_required");
    if (kind === "every" && (isNaN(Number(everyMin)) || Number(everyMin) < 1))
      return tr("err_interval_invalid");
    if (kind === "at" && !atWhen.trim()) return tr("err_datetime_required");
    return undefined;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(undefined);

    const body: CronJobCreateInput = {
      name: name.trim(),
      description: desc.trim() || undefined,
      enabled: true,
      schedule: buildSchedule(),
      payload: { kind: "command", command: command.trim() },
    };

    try {
      const res = await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? tr("err_create"));
        setSaving(false);
        return;
      }
      onCreated();
    } catch {
      setError(tr("err_network"));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      {/* Nome */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("label_name")}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="scout-linkedin"
          className={inputCls}
          style={{ color: "var(--color-bright)" }}
        />
      </div>
      {/* Descrizione */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("label_desc")}
        </label>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={tr("ph_desc")}
          className={inputCls}
          style={{ color: "var(--color-bright)" }}
        />
      </div>
      {/* Comando */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("label_command")}
        </label>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="jht scout run"
          className={inputCls}
          style={{ color: "var(--color-bright)" }}
        />
      </div>
      {/* Schedule kind */}
      <div className="flex flex-col gap-2">
        <label
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("label_frequency")}
        </label>
        <div className="flex gap-2">
          {SCHEDULE_KINDS.map((k) => (
            <button
              key={k.value}
              onClick={() => setKind(k.value)}
              className="flex-1 py-1.5 rounded text-[10px] font-semibold tracking-wide cursor-pointer transition-all"
              style={
                kind === k.value
                  ? { background: "var(--color-green)", color: "#000" }
                  : {
                      background: "var(--color-card)",
                      color: "var(--color-muted)",
                      border: "1px solid var(--color-border)",
                    }
              }
            >
              {k.label}
            </button>
          ))}
        </div>
        {kind === "cron" && (
          <input
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            placeholder="0 9 * * 1-5"
            aria-label={tr("aria_cron")}
            className={inputCls}
            style={{ color: "var(--color-bright)" }}
          />
        )}
        {kind === "every" && (
          <input
            value={everyMin}
            onChange={(e) => setEveryMin(e.target.value)}
            type="number"
            min="1"
            placeholder="30"
            aria-label={tr("aria_interval")}
            className={inputCls}
            style={{ color: "var(--color-bright)" }}
          />
        )}
        {kind === "at" && (
          <input
            value={atWhen}
            onChange={(e) => setAtWhen(e.target.value)}
            placeholder="2026-04-10 09:00"
            aria-label={tr("aria_datetime")}
            className={inputCls}
            style={{ color: "var(--color-bright)" }}
          />
        )}
      </div>
      {error && (
        <p className="text-[11px]" style={{ color: "var(--color-red)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded text-[12px] font-semibold cursor-pointer"
          style={{
            border: "1px solid var(--color-border)",
            color: "var(--color-muted)",
            background: "transparent",
          }}
        >
          {tr("cancel")}
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 py-2.5 rounded text-[12px] font-bold cursor-pointer transition-all"
          style={
            saving
              ? { background: "var(--color-border)", color: "var(--color-dim)" }
              : { background: "var(--color-green)", color: "#000" }
          }
        >
          {saving ? tr("creating") : tr("create_job")}
        </button>
      </div>
    </div>
  );
}
