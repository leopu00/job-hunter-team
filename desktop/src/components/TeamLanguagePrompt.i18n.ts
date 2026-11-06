import type { Locale } from "@/i18n/config";

export interface TeamLanguageText {
  /** The question about the team's language, asked once per language of the app when the team speaks another one. `{language}` is the app's language, by its own name. */
  title: string;
  /** What the question says and what the answer changes. */
  body: string;
  /** The accessible name of the language list. */
  selectLabel: string;
  /** Writes the chosen language to the team. */
  confirm: string;
  /** What the question says when the team already speaks a language that is not English (the app's language changed). `{language}` is the team's. */
  bodyOther: string;
  /** Leaves the team in English and does not ask again. */
  keepEnglish: string;
  /** Leaves the team in its language (`{language}`) and does not ask again for this language of the app. */
  keepCurrent: string;
  /** Settings › Team: the row that changes the team's language at any time. */
  cardTitle: string;
  cardText: string;
  /** The row's button. */
  cardSave: string;
  /** Said after the team took the language. */
  cardSaved: string;
  /** The confirm button while the write runs. */
  working: string;
}

export const TEAM_LANGUAGE_TEXT: Record<Locale, TeamLanguageText> = {
  it: {
    title: "Lingua della squadra: {language}?",
    body: "La squadra parla ancora inglese, la lingua con cui è stata installata, e i suoi agenti ti rispondono in inglese. Scegli la lingua in cui vuoi che ti parlino: vale per tutti gli agenti dal loro prossimo avvio.",
    selectLabel: "Lingua della squadra",
    confirm: "Usa questa lingua",
    bodyOther: "La squadra parla {language}, non la lingua dell’app, e i suoi agenti ti rispondono in {language}. Scegli la lingua in cui vuoi che ti parlino: vale per tutti gli agenti.",
    keepEnglish: "Lascia l’inglese",
    keepCurrent: "Lascia {language}",
    working: "Salvo…",
    cardTitle: "Lingua della squadra",
    cardText: "La lingua in cui ti parlano gli agenti: nella chat e in tutto quello che scrivono per te. Cambiarla non rifà la preparazione.",
    cardSave: "Salva",
    cardSaved: "Fatto: gli agenti useranno questa lingua.",
  },
  en: {
    title: "Team language: {language}?",
    body: "The team still speaks English, the language it was installed with, and its agents answer you in English. Choose the language you want them to speak: it applies to every agent from its next start.",
    selectLabel: "Team language",
    confirm: "Use this language",
    bodyOther: "The team speaks {language}, not the app’s language, and its agents answer you in {language}. Choose the language you want them to speak: it applies to every agent.",
    keepEnglish: "Keep English",
    keepCurrent: "Keep {language}",
    working: "Saving…",
    cardTitle: "Team language",
    cardText: "The language the agents speak to you: in the chat and in everything they write for you. Changing it does not run the setup again.",
    cardSave: "Save",
    cardSaved: "Done: the agents will use this language.",
  },
  hu: {
    title: "A csapat nyelve: {language}?",
    body: "A csapat még angolul beszél, azon a nyelven, amellyel telepítették, és az ügynökei angolul válaszolnak neked. Válaszd ki, milyen nyelven beszéljenek veled: minden ügynökre a következő indításától érvényes.",
    selectLabel: "A csapat nyelve",
    confirm: "Ezt a nyelvet használom",
    bodyOther: "A csapat {language} nyelven beszél, nem az alkalmazás nyelvén, és az ügynökei {language} nyelven válaszolnak neked. Válaszd ki, milyen nyelven beszéljenek veled: minden ügynökre érvényes.",
    keepEnglish: "Maradjon az angol",
    keepCurrent: "Maradjon: {language}",
    working: "Mentés…",
    cardTitle: "A csapat nyelve",
    cardText: "Az a nyelv, amelyen az ügynökök beszélnek veled: a csevegésben és mindenben, amit neked írnak. A módosítása nem futtatja újra a telepítést.",
    cardSave: "Mentés",
    cardSaved: "Kész: az ügynökök ezt a nyelvet fogják használni.",
  },
  es: {
    title: "Idioma del equipo: ¿{language}?",
    body: "El equipo todavía habla inglés, el idioma con el que se instaló, y sus agentes te responden en inglés. Elige el idioma en el que quieres que te hablen: vale para cada agente desde su próximo arranque.",
    selectLabel: "Idioma del equipo",
    confirm: "Usar este idioma",
    bodyOther: "El equipo habla {language}, no el idioma de la app, y sus agentes te responden en {language}. Elige el idioma en el que quieres que te hablen: vale para todos los agentes.",
    keepEnglish: "Dejar el inglés",
    keepCurrent: "Dejar {language}",
    working: "Guardando…",
    cardTitle: "Idioma del equipo",
    cardText: "El idioma en el que te hablan los agentes: en el chat y en todo lo que escriben para ti. Cambiarlo no repite la preparación.",
    cardSave: "Guardar",
    cardSaved: "Hecho: los agentes usarán este idioma.",
  },
  de: {
    title: "Sprache des Teams: {language}?",
    body: "Das Team spricht noch Englisch, die Sprache, mit der es installiert wurde, und seine Agenten antworten dir auf Englisch. Wähle die Sprache, in der sie mit dir sprechen sollen: Sie gilt für jeden Agenten ab seinem nächsten Start.",
    selectLabel: "Sprache des Teams",
    confirm: "Diese Sprache verwenden",
    bodyOther: "Das Team spricht {language}, nicht die Sprache der App, und seine Agenten antworten dir auf {language}. Wähle die Sprache, in der sie mit dir sprechen sollen: Sie gilt für jeden Agenten.",
    keepEnglish: "Englisch beibehalten",
    keepCurrent: "{language} beibehalten",
    working: "Speichere…",
    cardTitle: "Sprache des Teams",
    cardText: "Die Sprache, in der die Agenten mit dir sprechen: im Chat und in allem, was sie für dich schreiben. Eine Änderung startet die Einrichtung nicht neu.",
    cardSave: "Speichern",
    cardSaved: "Erledigt: Die Agenten verwenden diese Sprache.",
  },
  fr: {
    title: "Langue de l’équipe : {language} ?",
    body: "L’équipe parle encore anglais, la langue avec laquelle elle a été installée, et ses agents te répondent en anglais. Choisis la langue dans laquelle tu veux qu’ils te parlent : elle s’applique à chaque agent dès son prochain démarrage.",
    selectLabel: "Langue de l’équipe",
    confirm: "Utiliser cette langue",
    bodyOther: "L’équipe parle {language}, pas la langue de l’app, et ses agents te répondent en {language}. Choisis la langue dans laquelle tu veux qu’ils te parlent : elle s’applique à chaque agent.",
    keepEnglish: "Garder l’anglais",
    keepCurrent: "Garder {language}",
    working: "Enregistrement…",
    cardTitle: "Langue de l’équipe",
    cardText: "La langue dans laquelle les agents te parlent : dans le chat et dans tout ce qu’ils écrivent pour toi. La changer ne relance pas l’installation.",
    cardSave: "Enregistrer",
    cardSaved: "C’est fait : les agents utiliseront cette langue.",
  },
  pt: {
    title: "Idioma da equipa: {language}?",
    body: "A equipa ainda fala inglês, o idioma com que foi instalada, e os seus agentes respondem-te em inglês. Escolhe o idioma em que queres que te falem: vale para cada agente a partir do seu próximo arranque.",
    selectLabel: "Idioma da equipa",
    confirm: "Usar este idioma",
    bodyOther: "A equipa fala {language}, não o idioma da app, e os seus agentes respondem-te em {language}. Escolhe o idioma em que queres que te falem: vale para todos os agentes.",
    keepEnglish: "Manter o inglês",
    keepCurrent: "Manter {language}",
    working: "A guardar…",
    cardTitle: "Idioma da equipa",
    cardText: "O idioma em que os agentes te falam: no chat e em tudo o que escrevem para ti. Mudá-lo não repete a preparação.",
    cardSave: "Guardar",
    cardSaved: "Feito: os agentes vão usar este idioma.",
  },
};
