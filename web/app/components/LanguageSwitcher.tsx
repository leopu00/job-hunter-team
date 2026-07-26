"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { localeLabels, type Locale } from "../../i18n/config";
import { FLAGS } from "@/app/components/LocaleFlags";

type LocaleInfo = { code: Locale; label: string; flag: string };

export default function LanguageSwitcher({
  direction = "up",
}: {
  direction?: "up" | "down";
}) {
  const [current, setCurrent] = useState<Locale | null>(null);
  const [locales, setLocales] = useState<LocaleInfo[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchLocale = useCallback(async () => {
    const res = await fetch("/api/i18n?t=" + Date.now()).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setCurrent((data.current as Locale) ?? "it");
    setLocales(data.locales ?? []);
  }, []);

  useEffect(() => {
    fetchLocale();
  }, [fetchLocale]);

  const switchLocale = async (code: Locale) => {
    setOpen(false);
    if (!current || code === current) return;
    const res = await fetch("/api/i18n", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: code }),
    }).catch(() => null);
    if (res?.ok) {
      setCurrent(code);
      // Tiene in sync la landing, che legge la lingua da localStorage.
      try {
        localStorage.setItem("jht-lang", code);
      } catch {
        /* localStorage non disponibile */
      }
      window.location.reload();
    }
  };

  if (!current) return null;
  const CurrentFlag = FLAGS[current] || FLAGS.en;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 py-0 px-0 transition-all cursor-pointer"
        aria-label={`Language: ${localeLabels[current!]?.label || current}`}
        aria-expanded={open}
      >
        <CurrentFlag />
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{
            opacity: 0.5,
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "",
          }}
        >
          <path
            d="M2 4L5 7L8 4"
            stroke="var(--color-muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute right-0 ${direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"} overflow-hidden`}
          style={{
            background: "var(--color-panel)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 100,
            minWidth: 140,
          }}
        >
          {[...locales]
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((l) => {
              const Flag = FLAGS[l.code] || FLAGS.en;
              return (
                <button
                  key={l.code}
                  role="option"
                  aria-selected={l.code === current}
                  onClick={() => switchLocale(l.code)}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors cursor-pointer"
                  style={{
                    background:
                      l.code === current ? "var(--color-card)" : "transparent",
                    color:
                      l.code === current
                        ? "var(--color-white)"
                        : "var(--color-muted)",
                    fontSize: 11,
                    fontWeight: l.code === current ? 600 : 400,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <Flag />
                  <span>{l.label}</span>
                  {l.code === current && (
                    <svg
                      aria-hidden="true"
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      className="ml-auto"
                    >
                      <path
                        d="M2 5L4 7L8 3"
                        stroke="var(--color-green)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
