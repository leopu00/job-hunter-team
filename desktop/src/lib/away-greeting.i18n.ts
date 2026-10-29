import type { Locale } from "@/i18n/config";
import type { PluralForms } from "./plural";

/**
 * The words of the greeting on coming back: what the team did while the window was closed. Each count has its
 * singular and its plural; `{count}` is the number.
 */
export type AwayGreetingText = {
  /** The label of the strip for a screen reader, and the start of the sentence. */
  intro: string;
  positions: PluralForms;
  evaluated: PluralForms;
  documents: PluralForms;
  seePositions: string;
  seeDashboard: string;
  close: string;
};

export const AWAY_GREETING_TEXT: Record<Locale, AwayGreetingText> = {
  it: {
    intro: "Mentre eri via:",
    positions: { one: "{count} posizione nuova", other: "{count} posizioni nuove" },
    evaluated: { one: "{count} valutata", other: "{count} valutate" },
    documents: { one: "{count} CV o lettera pronto", other: "{count} CV o lettere pronti" },
    seePositions: "Vedi le posizioni",
    seeDashboard: "Vai al cruscotto",
    close: "Chiudi",
  },
  en: {
    intro: "While you were away:",
    positions: { one: "{count} new position", other: "{count} new positions" },
    evaluated: { one: "{count} evaluated", other: "{count} evaluated" },
    documents: { one: "{count} CV or letter ready", other: "{count} CVs or letters ready" },
    seePositions: "See the positions",
    seeDashboard: "Go to the dashboard",
    close: "Close",
  },
  de: {
    intro: "Während du weg warst:",
    positions: { one: "{count} neue Stelle", other: "{count} neue Stellen" },
    evaluated: { one: "{count} bewertet", other: "{count} bewertet" },
    documents: { one: "{count} Lebenslauf oder Anschreiben fertig", other: "{count} Lebensläufe oder Anschreiben fertig" },
    seePositions: "Stellen ansehen",
    seeDashboard: "Zum Dashboard",
    close: "Schließen",
  },
  fr: {
    intro: "Pendant ton absence :",
    positions: { one: "{count} nouveau poste", other: "{count} nouveaux postes" },
    evaluated: { one: "{count} évalué", other: "{count} évalués" },
    documents: { one: "{count} CV ou lettre prêt", other: "{count} CV ou lettres prêts" },
    seePositions: "Voir les postes",
    seeDashboard: "Aller au tableau de bord",
    close: "Fermer",
  },
  es: {
    intro: "Mientras no estabas:",
    positions: { one: "{count} posición nueva", other: "{count} posiciones nuevas" },
    evaluated: { one: "{count} valorada", other: "{count} valoradas" },
    documents: { one: "{count} CV o carta listo", other: "{count} CV o cartas listos" },
    seePositions: "Ver las posiciones",
    seeDashboard: "Ir al panel",
    close: "Cerrar",
  },
  pt: {
    intro: "Enquanto estiveste fora:",
    positions: { one: "{count} posição nova", other: "{count} posições novas" },
    evaluated: { one: "{count} avaliada", other: "{count} avaliadas" },
    documents: { one: "{count} CV ou carta pronto", other: "{count} CVs ou cartas prontos" },
    seePositions: "Ver as posições",
    seeDashboard: "Ir para o painel",
    close: "Fechar",
  },
  hu: {
    intro: "Amíg távol voltál:",
    positions: { one: "{count} új pozíció", other: "{count} új pozíció" },
    evaluated: { one: "{count} értékelve", other: "{count} értékelve" },
    documents: { one: "{count} kész önéletrajz vagy levél", other: "{count} kész önéletrajz vagy levél" },
    seePositions: "Pozíciók megtekintése",
    seeDashboard: "Irány a vezérlőpult",
    close: "Bezárás",
  },
};
