"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { IconSort } from "./icons";

// "Ordina per" della toolbar mobile (20/07): la vista a card non ha le
// intestazioni di colonna cliccabili della tabella, quindi l'ordinamento
// serve un controllo suo. Stessi parametri URL della tabella (sort/dir).
const SORT_OPTIONS = [
  "last_action_at",
  "found_at",
  "score",
  "salary",
  "title",
  "company",
] as const;

const T: Record<
  Locale,
  {
    label: string;
    title: string;
    close: string;
    asc: string;
    desc: string;
    options: Record<(typeof SORT_OPTIONS)[number], string>;
  }
> = {
  it: {
    label: "Ordina",
    title: "Ordina per",
    close: "Chiudi",
    asc: "Crescente",
    desc: "Decrescente",
    options: {
      last_action_at: "Ultima attività",
      found_at: "Data ritrovamento",
      score: "Score",
      salary: "Stipendio",
      title: "Titolo",
      company: "Azienda",
    },
  },
  en: {
    label: "Sort",
    title: "Sort by",
    close: "Close",
    asc: "Ascending",
    desc: "Descending",
    options: {
      last_action_at: "Last activity",
      found_at: "Found date",
      score: "Score",
      salary: "Salary",
      title: "Title",
      company: "Company",
    },
  },
  hu: {
    label: "Rendezés",
    title: "Rendezés",
    close: "Bezárás",
    asc: "Növekvő",
    desc: "Csökkenő",
    options: {
      last_action_at: "Utolsó aktivitás",
      found_at: "Megtalálás dátuma",
      score: "Pontszám",
      salary: "Fizetés",
      title: "Cím",
      company: "Cég",
    },
  },
  es: {
    label: "Ordenar",
    title: "Ordenar por",
    close: "Cerrar",
    asc: "Ascendente",
    desc: "Descendente",
    options: {
      last_action_at: "Última actividad",
      found_at: "Fecha de hallazgo",
      score: "Puntuación",
      salary: "Salario",
      title: "Título",
      company: "Empresa",
    },
  },
  de: {
    label: "Sortieren",
    title: "Sortieren nach",
    close: "Schließen",
    asc: "Aufsteigend",
    desc: "Absteigend",
    options: {
      last_action_at: "Letzte Aktivität",
      found_at: "Funddatum",
      score: "Score",
      salary: "Gehalt",
      title: "Titel",
      company: "Unternehmen",
    },
  },
  fr: {
    label: "Trier",
    title: "Trier par",
    close: "Fermer",
    asc: "Croissant",
    desc: "Décroissant",
    options: {
      last_action_at: "Dernière activité",
      found_at: "Date de découverte",
      score: "Score",
      salary: "Salaire",
      title: "Titre",
      company: "Entreprise",
    },
  },
  pt: {
    label: "Ordenar",
    title: "Ordenar por",
    close: "Fechar",
    asc: "Ascendente",
    desc: "Descendente",
    options: {
      last_action_at: "Última atividade",
      found_at: "Data de descoberta",
      score: "Pontuação",
      salary: "Salário",
      title: "Título",
      company: "Empresa",
    },
  },
};

export default function SortPicker() {
  const t = T[useLocale()] ?? T.en;
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cur = sp.get("sort") ?? "last_action_at";
  const dir: "asc" | "desc" = sp.get("dir") === "asc" ? "asc" : "desc";
  const active = cur !== "last_action_at" || dir !== "desc";

  const push = (sort: string, d: "asc" | "desc") => {
    const next = new URLSearchParams(sp.toString());
    if (sort === "last_action_at") next.delete("sort");
    else next.set("sort", sort);
    if (d === "desc") next.delete("dir");
    else next.set("dir", d);
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `/positions?${qs}` : "/positions", { scroll: false });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t.title}
        aria-label={t.title}
        className="h-8 px-3 inline-flex md:hidden items-center gap-2 text-[10px] font-semibold tracking-[0.14em] uppercase rounded-lg border cursor-pointer transition-colors"
        style={{
          borderColor: active ? "var(--color-purple)" : "var(--color-border)",
          color: active ? "var(--color-purple)" : "var(--color-base)",
          background: "var(--color-card)",
        }}
      >
        <IconSort dir="none" />
        {t.label}
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label={t.title}
          >
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setOpen(false)}
            />
            <div
              className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-card)",
              }}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="section-label">{t.title}</div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t.close}
                  className="rounded-lg p-1.5 text-[16px] leading-none transition-colors hover:bg-[var(--color-row)]"
                  style={{ color: "var(--color-dim)" }}
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                {SORT_OPTIONS.map((k) => {
                  const on = cur === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        push(k, dir);
                        setOpen(false);
                      }}
                      className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-[12px] font-semibold transition-colors"
                      style={{
                        borderColor: on
                          ? "var(--color-purple)"
                          : "var(--color-border)",
                        color: on ? "var(--color-purple)" : "var(--color-base)",
                        background: on
                          ? "color-mix(in srgb, var(--color-purple) 8%, transparent)"
                          : "transparent",
                      }}
                    >
                      {t.options[k]}
                      {on && <span aria-hidden>✓</span>}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex gap-2">
                {(["desc", "asc"] as const).map((d) => {
                  const on = dir === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => push(cur, d)}
                      className="flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors"
                      style={{
                        borderColor: on
                          ? "var(--color-purple)"
                          : "var(--color-border)",
                        color: on
                          ? "var(--color-purple)"
                          : "var(--color-muted)",
                        background: on
                          ? "color-mix(in srgb, var(--color-purple) 8%, transparent)"
                          : "transparent",
                      }}
                    >
                      {d === "desc" ? t.desc : t.asc}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
