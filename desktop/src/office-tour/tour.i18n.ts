import type { LocaleDict } from "@/lib/i18n-dict";

/** The words of the tour's own controls. What the Assistant and the colleagues say is in tour-speech.i18n.ts. */

export const TOUR_ARIA: LocaleDict = {
  en: "Tour of the office",
  it: "Giro dell’ufficio",
  hu: "Az iroda bemutatása",
  es: "Visita a la oficina",
  de: "Rundgang durch das Büro",
  fr: "Visite du bureau",
  pt: "Visita ao escritório",
};

export const TOUR_START_BUTTON: LocaleDict = {
  en: "Take the tour",
  it: "Facciamo il giro",
  hu: "Induljunk",
  es: "Hagamos la visita",
  de: "Rundgang starten",
  fr: "Faisons la visite",
  pt: "Vamos à visita",
};

export const TOUR_LATER_BUTTON: LocaleDict = {
  en: "Not now",
  it: "Non ora",
  hu: "Most nem",
  es: "Ahora no",
  de: "Jetzt nicht",
  fr: "Pas maintenant",
  pt: "Agora não",
};

export const TOUR_NEXT_BUTTON: LocaleDict = {
  en: "Next",
  it: "Avanti",
  hu: "Tovább",
  es: "Siguiente",
  de: "Weiter",
  fr: "Suivant",
  pt: "Seguinte",
};

export const TOUR_FINISH_BUTTON: LocaleDict = {
  en: "Finish the tour",
  it: "Concludi il giro",
  hu: "Bejárás vége",
  es: "Terminar la visita",
  de: "Rundgang beenden",
  fr: "Terminer la visite",
  pt: "Terminar a visita",
};

export const TOUR_PAUSE_BUTTON: LocaleDict = {
  en: "Pause the tour",
  it: "Metti in pausa il giro",
  hu: "Bejárás szüneteltetése",
  es: "Pausar la visita",
  de: "Rundgang pausieren",
  fr: "Mettre la visite en pause",
  pt: "Pôr a visita em pausa",
};

export const TOUR_RESUME_BUTTON: LocaleDict = {
  en: "Resume the tour",
  it: "Riprendi il giro",
  hu: "Bejárás folytatása",
  es: "Reanudar la visita",
  de: "Rundgang fortsetzen",
  fr: "Reprendre la visite",
  pt: "Retomar a visita",
};

/** «Stop {n} of {total}». */
export const TOUR_COUNTER: LocaleDict = {
  en: "Stop {n} of {total}",
  it: "Tappa {n} di {total}",
  hu: "{n}. állomás a(z) {total}-ből",
  es: "Parada {n} de {total}",
  de: "Station {n} von {total}",
  fr: "Étape {n} sur {total}",
  pt: "Paragem {n} de {total}",
};
