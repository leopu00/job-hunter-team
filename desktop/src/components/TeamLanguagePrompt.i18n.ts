import type { Locale } from "@/i18n/config";

export interface TeamLanguageText {
  /** The question about the team's language, asked once when its agents still speak the English they were installed with. `{language}` is the app's language, by its own name. */
  title: string;
  /** What the question says and what the answer changes. */
  body: string;
  /** The accessible name of the language list. */
  selectLabel: string;
  /** Writes the chosen language to the team. */
  confirm: string;
  /** Leaves the team in English and does not ask again. */
  keepEnglish: string;
  /** The confirm button while the write runs. */
  working: string;
}

export const TEAM_LANGUAGE_TEXT: Record<Locale, TeamLanguageText> = {
  it: {
    title: "Lingua della squadra: {language}?",
    body: "La squadra parla ancora inglese, la lingua con cui è stata installata, e i suoi agenti ti rispondono in inglese. Scegli la lingua in cui vuoi che ti parlino: vale per tutti gli agenti dal loro prossimo avvio.",
    selectLabel: "Lingua della squadra",
    confirm: "Usa questa lingua",
    keepEnglish: "Lascia l’inglese",
    working: "Salvo…",
  },
  en: {
    title: "Team language: {language}?",
    body: "The team still speaks English, the language it was installed with, and its agents answer you in English. Choose the language you want them to speak: it applies to every agent from its next start.",
    selectLabel: "Team language",
    confirm: "Use this language",
    keepEnglish: "Keep English",
    working: "Saving…",
  },
  hu: {
    title: "A csapat nyelve: {language}?",
    body: "A csapat még angolul beszél, azon a nyelven, amellyel telepítették, és az ügynökei angolul válaszolnak neked. Válaszd ki, milyen nyelven beszéljenek veled: minden ügynökre a következő indításától érvényes.",
    selectLabel: "A csapat nyelve",
    confirm: "Ezt a nyelvet használom",
    keepEnglish: "Maradjon az angol",
    working: "Mentés…",
  },
  es: {
    title: "Idioma del equipo: ¿{language}?",
    body: "El equipo todavía habla inglés, el idioma con el que se instaló, y sus agentes te responden en inglés. Elige el idioma en el que quieres que te hablen: vale para cada agente desde su próximo arranque.",
    selectLabel: "Idioma del equipo",
    confirm: "Usar este idioma",
    keepEnglish: "Dejar el inglés",
    working: "Guardando…",
  },
  de: {
    title: "Sprache des Teams: {language}?",
    body: "Das Team spricht noch Englisch, die Sprache, mit der es installiert wurde, und seine Agenten antworten dir auf Englisch. Wähle die Sprache, in der sie mit dir sprechen sollen: Sie gilt für jeden Agenten ab seinem nächsten Start.",
    selectLabel: "Sprache des Teams",
    confirm: "Diese Sprache verwenden",
    keepEnglish: "Englisch beibehalten",
    working: "Speichere…",
  },
  fr: {
    title: "Langue de l’équipe : {language} ?",
    body: "L’équipe parle encore anglais, la langue avec laquelle elle a été installée, et ses agents te répondent en anglais. Choisis la langue dans laquelle tu veux qu’ils te parlent : elle s’applique à chaque agent dès son prochain démarrage.",
    selectLabel: "Langue de l’équipe",
    confirm: "Utiliser cette langue",
    keepEnglish: "Garder l’anglais",
    working: "Enregistrement…",
  },
  pt: {
    title: "Idioma da equipa: {language}?",
    body: "A equipa ainda fala inglês, o idioma com que foi instalada, e os seus agentes respondem-te em inglês. Escolhe o idioma em que queres que te falem: vale para cada agente a partir do seu próximo arranque.",
    selectLabel: "Idioma da equipa",
    confirm: "Usar este idioma",
    keepEnglish: "Manter o inglês",
    working: "A guardar…",
  },
};
