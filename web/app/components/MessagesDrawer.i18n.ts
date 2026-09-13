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
  answer_exact_hint: {
    it: "Rispondi a questa richiesta. Per una scelta, copia esattamente una delle opzioni mostrate.",
    en: "Answer this request. For a choice, copy one of the displayed options exactly.",
    hu: "Válaszolj erre a kérésre. Választásnál pontosan másold le az egyik megjelenített lehetőséget.",
    es: "Responde a esta solicitud. Si es una elección, copia exactamente una de las opciones mostradas.",
    de: "Beantworte diese Anfrage. Kopiere bei einer Auswahl genau eine der angezeigten Optionen.",
    fr: "Répondez à cette demande. Pour un choix, copiez exactement l’une des options affichées.",
    pt: "Responda a esta solicitação. Para uma escolha, copie exatamente uma das opções exibidas.",
  },
  application_answer_placeholder: {
    it: "La tua risposta esatta…",
    en: "Your exact answer…",
    hu: "A pontos válaszod…",
    es: "Tu respuesta exacta…",
    de: "Deine genaue Antwort…",
    fr: "Votre réponse exacte…",
    pt: "Sua resposta exata…",
  },
  save_answer: {
    it: "Salva risposta",
    en: "Save answer",
    hu: "Válasz mentése",
    es: "Guardar respuesta",
    de: "Antwort speichern",
    fr: "Enregistrer la réponse",
    pt: "Salvar resposta",
  },
  saving_answer: {
    it: "Salvataggio…",
    en: "Saving…",
    hu: "Mentés…",
    es: "Guardando…",
    de: "Wird gespeichert…",
    fr: "Enregistrement…",
    pt: "Salvando…",
  },
  answer_invalid: {
    it: "La risposta non corrisponde esattamente a una delle opzioni mostrate.",
    en: "The answer does not exactly match one of the displayed options.",
    hu: "A válasz nem egyezik pontosan egyik megjelenített lehetőséggel sem.",
    es: "La respuesta no coincide exactamente con una de las opciones mostradas.",
    de: "Die Antwort stimmt nicht genau mit einer der angezeigten Optionen überein.",
    fr: "La réponse ne correspond pas exactement à l’une des options affichées.",
    pt: "A resposta não corresponde exatamente a uma das opções exibidas.",
  },
} satisfies Dictionary;
