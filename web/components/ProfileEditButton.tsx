"use client";

import { openProfileAssistant } from "@/lib/profile-assistant-bus";
import { useLocale } from "@/lib/use-locale";

/**
 * Bottone "Modifica" della pagina profilo. Non porta più al form manuale
 * (`/profile/edit`, rimosso): apre la chat dell'Assistente e invia subito un
 * messaggio, così l'agente risponde chiedendo cosa l'utente vuole cambiare.
 * Il profilo ha una struttura a blocchi che solo l'Assistente sa comporre
 * correttamente — l'editing manuale rompeva i dati (due modelli divergenti).
 */
// Messaggio iniettato nella chat (compare come messaggio utente): localizzato.
const SEED_MESSAGE: Record<string, string> = {
  it: "Vorrei modificare il mio profilo",
  en: "I'd like to edit my profile",
  hu: "Szeretném szerkeszteni a profilomat",
  es: "Me gustaría editar mi perfil",
  de: "Ich möchte mein Profil bearbeiten",
  fr: "Je voudrais modifier mon profil",
  pt: "Gostaria de editar o meu perfil",
};

export default function ProfileEditButton({ label }: { label: string }) {
  const locale = useLocale();
  return (
    <button
      type="button"
      onClick={() =>
        openProfileAssistant(SEED_MESSAGE[locale] ?? SEED_MESSAGE.en)
      }
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
