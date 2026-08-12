"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// O-60 — la barra di ricerca delle offerte.
//
// Sta nella toolbar sopra la tabella, non fra le colonne: la tabella scorre
// già in orizzontale, e un campo lì dentro sparirebbe dallo schermo proprio
// mentre lo si cerca.
//
// Il testo vive nell'URL come ogni altro filtro. Non è una scelta di stile:
// la tabella è un server component e il match deve arrivare al DATABASE —
// filtrare le righe già caricate cercherebbe dentro la pagina che si ha
// davanti, cioè esattamente dove l'utente ha già guardato senza trovare. In
// più un URL con la ricerca dentro si può mandare a qualcuno.
const T: Record<
  Locale,
  { placeholder: string; label: string; clear: string; searching: string }
> = {
  it: {
    placeholder: "Cerca azienda, titolo, ID…",
    label: "Cerca fra le posizioni",
    clear: "Cancella la ricerca",
    searching: "Ricerca in corso",
  },
  en: {
    placeholder: "Search company, title, ID…",
    label: "Search the positions",
    clear: "Clear the search",
    searching: "Searching",
  },
  hu: {
    placeholder: "Cég, pozíció, azonosító…",
    label: "Keresés a pozíciók között",
    clear: "Keresés törlése",
    searching: "Keresés folyamatban",
  },
  es: {
    placeholder: "Busca empresa, puesto, ID…",
    label: "Buscar entre las posiciones",
    clear: "Borrar la búsqueda",
    searching: "Buscando",
  },
  de: {
    placeholder: "Firma, Titel, ID suchen…",
    label: "Stellen durchsuchen",
    clear: "Suche löschen",
    searching: "Suche läuft",
  },
  fr: {
    placeholder: "Entreprise, intitulé, ID…",
    label: "Rechercher parmi les offres",
    clear: "Effacer la recherche",
    searching: "Recherche en cours",
  },
  pt: {
    placeholder: "Empresa, cargo, ID…",
    label: "Procurar nas posições",
    clear: "Limpar a pesquisa",
    searching: "A procurar",
  },
};

export default function PositionsSearch() {
  const t = T[useLocale()];
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [value, setValue] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Se l'URL cambia da fuori (link condiviso, "cancella", indietro del
  // browser) il campo segue: un input che mostra una ricerca diversa da
  // quella applicata è un modo silenzioso di mentire su cosa si sta vedendo.
  useEffect(() => setValue(urlQuery), [urlQuery]);

  function submit(next: string) {
    const merged = new URLSearchParams(params.toString());
    const trimmed = next.trim();
    if (trimmed) merged.set("q", trimmed);
    else merged.delete("q");
    // Una ricerca nuova riparte da pagina 1: restare a pagina 7 di un
    // risultato che ne ha due mostra una lista vuota che sembra "niente
    // trovato".
    merged.delete("page");
    const qs = merged.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      className="flex items-center h-8 rounded-lg border px-2 gap-1.5 min-w-0 w-[168px] sm:w-[232px] focus-within:border-[var(--color-green)] transition-colors"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        className="shrink-0 text-[var(--color-dim)]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t.placeholder}
        aria-label={t.label}
        // `search` nativo disegna la sua X su alcuni browser: la togliamo per
        // averne una sola, la nostra, che sa anche ripulire l'URL.
        className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--color-base)] placeholder:text-[var(--color-dim)] outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            submit("");
            inputRef.current?.focus();
          }}
          title={t.clear}
          aria-label={t.clear}
          className="shrink-0 text-[var(--color-dim)] hover:text-[var(--color-base)] cursor-pointer text-[12px] leading-none"
        >
          ×
        </button>
      )}
    </form>
  );
}
