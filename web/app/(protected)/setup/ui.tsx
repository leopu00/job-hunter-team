"use client";

/* Componenti UI condivisi per il wizard setup */

import React from "react";
import { useLocale } from "@/lib/use-locale";
import { t } from "./setup-i18n";

const btnPrimary: React.CSSProperties = {
  background: "var(--color-green)",
  color: "#000",
};
const btnSecondary: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  color: "var(--color-muted)",
  background: "transparent",
};

export function Card({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--color-border)]">
        <p
          className="text-[11px] font-bold tracking-widest uppercase"
          style={{ color: "var(--color-bright)" }}
        >
          {title}
        </p>
        {sub && (
          <p
            className="text-[10px] mt-0.5"
            style={{ color: "var(--color-dim)" }}
          >
            {sub}
          </p>
        )}
      </div>
      <div className="px-6 py-6 flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function NavButtons({
  onBack,
  onNext,
  nextLabel,
  disabled = false,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  disabled?: boolean;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-3">
      {onBack && (
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded text-[12px] font-semibold cursor-pointer"
          style={btnSecondary}
        >
          {t("nav_back", locale)}
        </button>
      )}
      <button
        onClick={onNext}
        disabled={disabled}
        className="flex-1 py-2.5 rounded text-[12px] font-bold cursor-pointer transition-all"
        style={
          disabled
            ? { background: "var(--color-border)", color: "var(--color-dim)" }
            : btnPrimary
        }
      >
        {nextLabel ?? t("nav_continue", locale)}
      </button>
    </div>
  );
}
