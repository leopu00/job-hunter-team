// Dizionario di `MessagesDrawer.tsx`.
//
// Le chiavi sono LOCALI a questo file: lo stesso nome può valere
// tutt'altro altrove (`empty` è "nessun backup" in una pagina e
// "nessun canale" in un'altra), quindi non vanno accorpate in un
// dizionario comune. `satisfies Dictionary` fa pretendere al
// compilatore tutte e sette le lingue: una voce a cui ne manca una
// non compila, invece di mostrare l'inglese all'utente sbagliato.
import type { Dictionary } from "@/lib/i18n-dict";
// Le voci in comune con la pagina /messages: la stessa feature, due UI.
import { THREAD_T } from "@/lib/messages-thread";

export const T = {
  ...THREAD_T,
  title: {
    it: "Messaggi",
    en: "Messages",
    hu: "Üzenetek",
    es: "Mensajes",
    de: "Nachrichten",
    fr: "Messages",
    pt: "Mensagens",
  },
  aria_open: {
    it: "Apri i messaggi del team",
    en: "Open team messages",
    hu: "Csapatüzenetek megnyitása",
    es: "Abrir mensajes del equipo",
    de: "Team-Nachrichten öffnen",
    fr: "Ouvrir les messages de l'équipe",
    pt: "Abrir mensagens da equipe",
  },
  close: {
    it: "Chiudi",
    en: "Close",
    hu: "Bezárás",
    es: "Cerrar",
    de: "Schließen",
    fr: "Fermer",
    pt: "Fechar",
  },
  back: {
    it: "Indietro",
    en: "Back",
    hu: "Vissza",
    es: "Atrás",
    de: "Zurück",
    fr: "Retour",
    pt: "Voltar",
  },
  empty: {
    it: "Nessun messaggio dal team, per ora.",
    en: "No messages from the team yet.",
    hu: "Egyelőre nincs üzenet a csapattól.",
    es: "Aún no hay mensajes del equipo.",
    de: "Noch keine Nachrichten vom Team.",
    fr: "Pas encore de messages de l'équipe.",
    pt: "Ainda não há mensagens da equipe.",
  },
} satisfies Dictionary;
