"use client";

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { validateTelegramToken, validateChatId } from "./providers";
import { Card, NavButtons, Field, inputCls } from "./ui";
import { t } from "./setup-i18n";
import type { FormState } from "./types";

interface Props {
  form: FormState;
  set: (f: Partial<FormState>) => void;
  next: () => void;
  back: () => void;
}

export function StepTelegram({ form, set, next, back }: Props) {
  const locale = useLocale();
  const [tokenErr, setTokenErr] = useState<string>();
  const [chatErr, setChatErr] = useState<string>();

  const validate = () => {
    if (!form.useTelegram) {
      next();
      return;
    }
    const te = validateTelegramToken(form.botToken, locale);
    const ce = validateChatId(form.chatId, locale);
    setTokenErr(te);
    setChatErr(ce);
    if (!te && !ce) next();
  };

  return (
    <Card title={t("tg_title", locale)} sub={t("tg_sub", locale)}>
      {/* Toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => set({ useTelegram: !form.useTelegram })}
          className="relative w-10 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0"
          style={{
            background: form.useTelegram
              ? "var(--color-green)"
              : "var(--color-border)",
          }}
        >
          <div
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
            style={{
              transform: form.useTelegram
                ? "translateX(22px)"
                : "translateX(2px)",
            }}
          />
        </button>
        <span className="text-[12px]" style={{ color: "var(--color-base)" }}>
          {t("tg_toggle", locale)}
        </span>
      </div>

      {form.useTelegram && (
        <>
          <Field label="Bot Token" error={tokenErr}>
            <input
              type="text"
              value={form.botToken}
              placeholder="123456:ABCdefGHI..."
              onChange={(e) => {
                set({ botToken: e.target.value });
                setTokenErr(undefined);
              }}
              className={inputCls}
              style={{ color: "var(--color-bright)" }}
            />
          </Field>
          <Field label={t("tg_chatid_label", locale)} error={chatErr}>
            <input
              type="text"
              value={form.chatId}
              placeholder="123456789"
              onChange={(e) => {
                set({ chatId: e.target.value });
                setChatErr(undefined);
              }}
              className={inputCls}
              style={{ color: "var(--color-bright)" }}
            />
          </Field>
          <p className="text-[10px]" style={{ color: "var(--color-dim)" }}>
            {t("tg_hint", locale)}
          </p>
        </>
      )}

      <NavButtons onBack={back} onNext={validate} />
    </Card>
  );
}
