"use client";

import { openProfileAssistant } from "@/lib/profile-assistant-bus";

/**
 * Bottone "Modifica" della pagina profilo. Non porta più al form manuale
 * (`/profile/edit`, rimosso): apre la chat dell'Assistente e invia subito un
 * messaggio, così l'agente risponde chiedendo cosa l'utente vuole cambiare.
 * Il profilo ha una struttura a blocchi che solo l'Assistente sa comporre
 * correttamente — l'editing manuale rompeva i dati (due modelli divergenti).
 */
export default function ProfileEditButton({
  label,
  message,
}: {
  label: string;
  message: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openProfileAssistant(message)}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold no-underline transition-all hover:opacity-90 cursor-pointer border-0"
      style={{ background: "var(--color-green)", color: "#000" }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
      {label}
    </button>
  );
}
