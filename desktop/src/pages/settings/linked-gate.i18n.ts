import type { Locale } from "@/i18n/config";

export interface LinkedGateText {
  /** What the page says instead of opening: the hours and models are written to the team, the link only reads. {connect} is the banner's own button. */
  needsFull: string;
  /** The button back to the settings. */
  back: string;
}

export const LINKED_GATE_TEXT: Record<Locale, LinkedGateText> = {
  it: {
    needsFull: "Gli orari di lavoro e i modelli si scrivono nella squadra, e questo collegamento la legge soltanto. Per cambiarli usa «{connect}» nella barra in alto.",
    back: "Impostazioni",
  },
  en: {
    needsFull: "The working hours and the models are written to the team, and this connection only reads it. To change them use “{connect}” in the bar above.",
    back: "Settings",
  },
  de: {
    needsFull: "Arbeitszeiten und Modelle werden ins Team geschrieben, und diese Verbindung liest es nur. Zum Ändern nutze „{connect}“ in der Leiste oben.",
    back: "Einstellungen",
  },
  fr: {
    needsFull: "Les horaires de travail et les modèles s’écrivent dans l’équipe, et cette connexion ne fait que la lire. Pour les changer, utilise « {connect} » dans la barre du haut.",
    back: "Paramètres",
  },
  es: {
    needsFull: "Los horarios de trabajo y los modelos se escriben en el equipo, y esta conexión solo lo lee. Para cambiarlos usa «{connect}» en la barra de arriba.",
    back: "Ajustes",
  },
  pt: {
    needsFull: "Os horários de trabalho e os modelos são escritos na equipa, e esta ligação só a lê. Para os mudar usa «{connect}» na barra de cima.",
    back: "Definições",
  },
  hu: {
    needsFull: "A munkaidőt és a modelleket a csapatba írja a program, ez a kapcsolat pedig csak olvas. A módosításhoz használd a felső sávban a „{connect}” gombot.",
    back: "Beállítások",
  },
};
