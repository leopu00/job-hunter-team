"use client";

import { useLocale } from "@/lib/use-locale";
import { Card, NavButtons } from "./ui";
import { t } from "./setup-i18n";
import type { FormState } from "./types";

interface Props {
  form: FormState;
  set: (f: Partial<FormState>) => void;
  next: () => void;
  back: () => void;
}

export function StepModel({ form, set, next, back }: Props) {
  const locale = useLocale();
  const models = form.provider!.models;
  return (
    <Card title={t("smodel_title", locale)} sub={t("smodel_sub", locale)}>
      <div className="flex flex-col gap-2">
        {models.map((m) => (
          <button
            key={m.value}
            onClick={() => set({ model: m.value })}
            className="text-left px-4 py-3 rounded border transition-all cursor-pointer"
            style={{
              borderColor:
                form.model === m.value
                  ? "var(--color-green)"
                  : "var(--color-border)",
              background:
                form.model === m.value
                  ? "rgba(0,232,122,0.06)"
                  : "var(--color-card)",
              color: "var(--color-bright)",
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold">{m.label}</span>
              <span
                className="text-[10px]"
                style={{ color: "var(--color-muted)" }}
              >
                {t(m.hintKey, locale)}
              </span>
            </div>
          </button>
        ))}
      </div>
      <NavButtons onBack={back} onNext={next} />
    </Card>
  );
}
