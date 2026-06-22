"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import { Card, btnPrimary, btnSecondary } from "./ui";
import { t } from "./setup-i18n";
import type { FormState } from "./types";

interface Props {
  form: FormState;
  back: () => void;
}

export function StepSummary({ form, back }: Props) {
  const router = useRouter();
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const p = form.provider!;

  const rows: [string, string][] = [
    [t("sum_row_provider", locale), p.label],
    [t("sum_row_model", locale), form.model],
    [
      t("sum_row_auth", locale),
      form.authMethod === "api_key"
        ? `API Key (${form.apiKey.slice(0, 8)}••••)`
        : `Subscription (${form.email})`,
    ],
    [
      t("sum_row_telegram", locale),
      form.useTelegram
        ? t("sum_configured", locale)
        : t("sum_not_configured", locale),
    ],
  ];

  const save = async () => {
    setSaving(true);
    setError(undefined);
    const provConf: Record<string, unknown> = {
      name: p.value,
      auth_method: form.authMethod,
      model: form.model,
    };
    if (form.authMethod === "api_key") provConf.api_key = form.apiKey;
    else provConf.subscription = { email: form.email };

    // workspace path e' fisso (~/.jht + ~/Documents/Job Hunter Team),
    // l'API /api/setup lo hardcoda da @/lib/jht-paths e ignora il body.
    const body = {
      active_provider: p.value,
      providers: { [p.value]: provConf },
      channels: form.useTelegram
        ? {
            telegram: {
              bot_token: form.botToken,
              ...(form.chatId.trim() ? { chat_id: form.chatId.trim() } : {}),
            },
          }
        : {},
    };

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? t("err_save", locale));
        setSaving(false);
        return;
      }
      router.push("/dashboard");
    } catch {
      setError(t("err_network", locale));
      setSaving(false);
    }
  };

  return (
    <Card title={t("sum_title", locale)} sub={t("sum_sub", locale)}>
      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-2.5">
            <span
              className="text-[10px] font-semibold tracking-widest uppercase"
              style={{ color: "var(--color-dim)" }}
            >
              {k}
            </span>
            <span
              className="text-[11px] font-mono"
              style={{ color: "var(--color-bright)" }}
            >
              {v}
            </span>
          </div>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="text-[11px]"
          style={{ color: "var(--color-red)" }}
        >
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={back}
          disabled={saving}
          className="flex-1 py-2.5 rounded text-[12px] font-semibold cursor-pointer"
          style={btnSecondary}
        >
          {t("sum_edit", locale)}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 py-2.5 rounded text-[12px] font-bold cursor-pointer transition-all"
          style={
            saving
              ? { background: "var(--color-border)", color: "var(--color-dim)" }
              : btnPrimary
          }
        >
          {saving ? t("sum_saving", locale) : t("sum_save_start", locale)}
        </button>
      </div>
    </Card>
  );
}
