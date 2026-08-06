"use client";

// I link operativi di una fase: scarica, apri la pagina di Docker, copia il
// comando.
//
// Il link di download non è scritto nelle fasi: lo risolve `guide-config`
// dal sistema selezionato. Così quando cambiano i nomi degli asset di
// release si tocca un file solo, e il selettore OS in cima alla pagina
// cambia anche i download senza che le fasi ne sappiano nulla.

import { useState } from "react";
import Link from "next/link";

import { GUIDE_UI } from "./guide-ui.i18n";
import { downloadUrlFor, resolveExternalHref } from "./guide-config";
import type { GuideLink, OsId } from "./guide-types";
import type { Lang } from "../components/landing/LandingI18n";

const ACTION_CLS =
  "inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-bright)] no-underline transition-colors hover:border-[var(--color-green)] hover:text-[var(--color-green)]";

function ExternalMark() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

/** Un comando da copiare. Se la clipboard è negata (http non sicuro,
 *  permesso rifiutato) lo dice e lascia il testo selezionabile: la fase
 *  resta eseguibile a mano. */
function CommandBlock({
  command,
  label,
  lang,
}: {
  command: string;
  label: string;
  lang: Lang;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="w-full">
      <p className="mb-1.5 text-[12px] text-[var(--color-muted)]">{label}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {/* Il comando va a capo invece di scorrere: su un telefono un
            blocco che scorre di lato nasconde metà comando a chi lo legge
            per digitarlo, e nessuno si accorge che c'è altro a destra. */}
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-[var(--color-bright)]">
          {command}
        </code>
        <button
          type="button"
          onClick={copy}
          className={`${ACTION_CLS} justify-center`}
        >
          {state === "copied" ? GUIDE_UI.copied[lang] : GUIDE_UI.copy[lang]}
        </button>
      </div>
      {state === "failed" && (
        <p className="mt-1.5 text-[11.5px] text-[var(--color-muted)]">
          {GUIDE_UI.copy_failed[lang]}
        </p>
      )}
    </div>
  );
}

export default function GuideLinks({
  links,
  os,
  lang,
}: {
  links: GuideLink[];
  os: OsId;
  lang: Lang;
}) {
  // I comandi stanno su una riga propria a piena larghezza, i bottoni si
  // dispongono in fila: mescolarli farebbe collassare il comando in una
  // colonna stretta dove non si legge.
  const commands = links.filter((link) => link.kind === "command");
  const buttons = links.filter((link) => link.kind !== "command");

  const rendered = buttons.map((link, index) => {
    const label = link.label[lang];

    if (link.kind === "internal") {
      return (
        <Link key={link.href} href={link.href} className={ACTION_CLS}>
          {label}
        </Link>
      );
    }

    const href =
      link.kind === "download"
        ? downloadUrlFor(os)
        : resolveExternalHref(link.href, os);
    // Un link esterno senza indirizzo per questo sistema non si mostra
    // spento: si omette. Un bottone che non porta da nessuna parte è peggio
    // di un bottone che non c'è.
    if (!href) return null;

    return (
      <a
        key={`${link.kind}-${index}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={ACTION_CLS}
      >
        {label}
        <ExternalMark />
      </a>
    );
  });

  const visible = rendered.filter(Boolean);
  if (visible.length === 0 && commands.length === 0) return null;

  return (
    <div className="mt-4 space-y-4">
      {visible.length > 0 && (
        <div className="flex flex-col flex-wrap gap-2 sm:flex-row">
          {visible}
        </div>
      )}
      {commands.map((link, index) =>
        link.kind === "command" ? (
          <CommandBlock
            key={`cmd-${index}`}
            command={link.command}
            label={link.label[lang]}
            lang={lang}
          />
        ) : null,
      )}
    </div>
  );
}
