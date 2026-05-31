"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Translations = {
  start_here: string;
  setup_intro: string;
  step1_title: string;
  step1_completed: string;
  step1_desc_done: string;
  step1_desc_todo: string;
  step2_title: string;
  step2_desc_done: string;
  step2_desc_todo: string;
  help_text: string;
  open_assistant: string;
};

type Props = {
  hasProfile: boolean;
  translations: Translations;
};

const STORAGE_KEY = "onboarding-popup:dismissed";
const PENDING_KEY = "onboarding-popup:pending";
const EVENT_NAME = "onboarding-popup-update";

function publishPending(hasProfile: boolean) {
  const pending = {
    profile: !hasProfile,
    team: hasProfile,
  };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: pending }));
}

export default function OnboardingPopup({
  hasProfile,
  translations: t,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    publishPending(hasProfile);
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {}
    if (!dismissed) setOpen(true);
  }, [hasProfile]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function handleClose() {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ animation: "fade-in 0.2s ease both" }}
      role="dialog"
      aria-modal="true"
      aria-label={t.start_here}
    >
      <div
        className="absolute inset-0 bg-black/70"
        onClick={handleClose}
        aria-hidden
      />
      <div className="relative w-full max-w-2xl border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 shadow-2xl">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-dim)] hover:text-[var(--color-bright)] hover:border-[var(--color-border-glow)] transition-colors text-[13px]"
        >
          ✕
        </button>

        <div className="section-label mb-5">{t.start_here}</div>
        <p className="text-[var(--color-muted)] text-[12px] mb-6 leading-relaxed">
          {t.setup_intro}
        </p>

        <div className="flex flex-col gap-4">
          <Link
            href="/profile"
            onClick={handleClose}
            className={`group flex items-start gap-4 p-4 rounded-lg border bg-[var(--color-panel)] no-underline transition-colors ${
              hasProfile
                ? "border-[var(--color-green)]/30"
                : "border-[var(--color-border)] hover:border-[#00e87a55]"
            }`}
          >
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full border text-[13px] font-bold shrink-0 mt-0.5 ${
                hasProfile
                  ? "border-[var(--color-green)] text-[var(--color-green)] bg-[var(--color-green)]/10"
                  : "border-[var(--color-green)] text-[var(--color-green)]"
              }`}
            >
              {hasProfile ? "✓" : "1"}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`text-[12px] font-bold mb-1 ${
                  hasProfile
                    ? "text-[var(--color-green)]"
                    : "text-[var(--color-bright)] group-hover:text-[var(--color-green)] transition-colors"
                }`}
              >
                {t.step1_title}
                {hasProfile && (
                  <span className="ml-2 text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--color-green)] bg-[var(--color-green)]/10 px-2 py-0.5 rounded-full border border-[var(--color-green)]/20">
                    {t.step1_completed}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0">
                {hasProfile ? t.step1_desc_done : t.step1_desc_todo}
              </p>
            </div>
            {!hasProfile && (
              <span className="text-[var(--color-dim)] group-hover:text-[var(--color-green)] text-[14px] transition-colors shrink-0 mt-1">
                →
              </span>
            )}
          </Link>

          <Link
            href="/team"
            onClick={(e) => {
              if (!hasProfile) {
                e.preventDefault();
                return;
              }
              handleClose();
            }}
            className={`group flex items-start gap-4 p-4 rounded-lg border bg-[var(--color-panel)] no-underline transition-colors ${
              hasProfile
                ? "border-[var(--color-border)] hover:border-[#ffc10755]"
                : "border-[var(--color-border)] opacity-50 pointer-events-none"
            }`}
          >
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full border text-[13px] font-bold shrink-0 mt-0.5 ${
                hasProfile
                  ? "border-[var(--color-yellow)] text-[var(--color-yellow)]"
                  : "border-[var(--color-dim)] text-[var(--color-dim)]"
              }`}
            >
              2
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`text-[12px] font-bold mb-1 ${
                  hasProfile
                    ? "text-[var(--color-bright)] group-hover:text-[var(--color-yellow)]"
                    : "text-[var(--color-dim)]"
                } transition-colors`}
              >
                {t.step2_title}
              </div>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0">
                {hasProfile ? t.step2_desc_done : t.step2_desc_todo}
              </p>
            </div>
            {hasProfile && (
              <span className="text-[var(--color-dim)] group-hover:text-[var(--color-yellow)] text-[14px] transition-colors shrink-0 mt-1">
                →
              </span>
            )}
          </Link>
        </div>

        <div className="mt-5 pt-4 border-t border-[var(--color-border)]">
          <Link
            href="/team/assistente"
            onClick={handleClose}
            className="group flex items-center gap-3 no-underline"
          >
            <span className="text-[11px] text-[var(--color-dim)] group-hover:text-[var(--color-muted)] transition-colors">
              {t.help_text}
            </span>
            <span className="text-[var(--color-dim)] group-hover:text-[var(--color-muted)] text-[12px] transition-colors shrink-0">
              {t.open_assistant}
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
