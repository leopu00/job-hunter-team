"use client";

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { validateApiKey, validateEmail } from "./providers";
import {
  Card,
  NavButtons,
  Field,
  inputCls,
  btnPrimary,
  btnSecondary,
} from "./ui";
import { t, authSub } from "./setup-i18n";
import type { FormState } from "./types";

interface Props {
  form: FormState;
  set: (f: Partial<FormState>) => void;
  next: () => void;
  back: () => void;
}

export function StepAuth({ form, set, next, back }: Props) {
  const locale = useLocale();
  const p = form.provider!;
  const [err, setErr] = useState<string>();
  const canSub = p.authMethods.includes("subscription");

  const validate = () => {
    const e =
      form.authMethod === "api_key"
        ? validateApiKey(p, form.apiKey, locale)
        : validateEmail(form.email, locale);
    if (e) {
      setErr(e);
      return;
    }
    setErr(undefined);
    next();
  };

  return (
    <Card title={t("auth_title", locale)} sub={authSub(p.label, locale)}>
      {canSub && (
        <div className="flex gap-2">
          {(["api_key", "subscription"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                set({ authMethod: m });
                setErr(undefined);
              }}
              className="flex-1 py-2 rounded text-[11px] font-semibold tracking-wide cursor-pointer transition-all"
              style={
                form.authMethod === m
                  ? btnPrimary
                  : { ...btnSecondary, borderRadius: "4px" }
              }
            >
              {m === "api_key" ? "API Key" : "Subscription"}
            </button>
          ))}
        </div>
      )}

      {form.authMethod === "api_key" ? (
        <Field label="API Key" error={err}>
          <input
            type="password"
            value={form.apiKey}
            placeholder={p.keyPlaceholder}
            onChange={(e) => {
              set({ apiKey: e.target.value });
              setErr(undefined);
            }}
            className={inputCls}
            style={{ color: "var(--color-bright)" }}
            autoComplete="off"
            required
          />
        </Field>
      ) : (
        <Field label={t("auth_email_label", locale)} error={err}>
          <input
            type="email"
            autoComplete="email"
            value={form.email}
            placeholder={t("auth_email_placeholder", locale)}
            onChange={(e) => {
              set({ email: e.target.value });
              setErr(undefined);
            }}
            className={inputCls}
            style={{ color: "var(--color-bright)" }}
            required
          />
        </Field>
      )}

      <NavButtons onBack={back} onNext={validate} />
    </Card>
  );
}
