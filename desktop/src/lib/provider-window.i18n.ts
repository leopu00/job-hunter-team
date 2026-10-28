import type { Locale } from "@/i18n/config";

/** The line the app shows when the AI provider's work window is nearly or fully used. Texts by the copy owner;
 *  {pct} is the percent used, {time} the local time (HH:MM) the window renews. */
export type ProviderWindowText = {
  usageNear: string;
  usageDone: string;
  usageDoneNoTime: string;
};

export const PROVIDER_WINDOW_TEXT: Record<Locale, ProviderWindowText> = {
  it: {
    usageNear: "Il tuo abbonamento AI sta per finire la finestra di lavoro ({pct}%): la squadra potrebbe fermarsi tra poco.",
    usageDone: "Il fornitore AI ha finito la finestra di lavoro: la squadra riprende alle {time}.",
    usageDoneNoTime: "Il fornitore AI ha finito la finestra di lavoro: la squadra riprende appena la finestra si rinnova.",
  },
  en: {
    usageNear: "Your AI subscription is about to use up its work window ({pct}%): the team may stop soon.",
    usageDone: "The AI provider has used up its work window: the team resumes at {time}.",
    usageDoneNoTime: "The AI provider has used up its work window: the team resumes as soon as the window renews.",
  },
  de: {
    usageNear: "Dein KI-Abonnement ist fast am Ende des Arbeitsfensters ({pct} %): Das Team könnte bald anhalten.",
    usageDone: "Der KI-Anbieter hat das Arbeitsfenster aufgebraucht: Das Team macht um {time} Uhr weiter.",
    usageDoneNoTime: "Der KI-Anbieter hat das Arbeitsfenster aufgebraucht: Das Team macht weiter, sobald sich das Fenster erneuert.",
  },
  es: {
    usageNear: "Tu suscripción de IA está a punto de agotar la ventana de trabajo ({pct} %): el equipo podría detenerse pronto.",
    usageDone: "El proveedor de IA ha agotado la ventana de trabajo: el equipo se reanuda a las {time}.",
    usageDoneNoTime: "El proveedor de IA ha agotado la ventana de trabajo: el equipo se reanuda en cuanto la ventana se renueve.",
  },
  fr: {
    usageNear: "Ton abonnement IA est sur le point d’épuiser sa fenêtre de travail ({pct} %) : l’équipe pourrait s’arrêter bientôt.",
    usageDone: "Le fournisseur d’IA a épuisé sa fenêtre de travail : l’équipe reprend à {time}.",
    usageDoneNoTime: "Le fournisseur d’IA a épuisé sa fenêtre de travail : l’équipe reprend dès que la fenêtre se renouvelle.",
  },
  hu: {
    usageNear: "Az MI-előfizetésed hamarosan kimeríti a munkaablakot ({pct}%): a csapat hamarosan leállhat.",
    usageDone: "Az MI-szolgáltató kimerítette a munkaablakot: a csapat {time}-kor folytatja.",
    usageDoneNoTime: "Az MI-szolgáltató kimerítette a munkaablakot: a csapat akkor folytatja, amikor az ablak megújul.",
  },
  pt: {
    usageNear: "A tua subscrição de IA está quase a esgotar a janela de trabalho ({pct} %): a equipa pode parar em breve.",
    usageDone: "O fornecedor de IA esgotou a janela de trabalho: a equipa retoma às {time}.",
    usageDoneNoTime: "O fornecedor de IA esgotou a janela de trabalho: a equipa retoma assim que a janela se renovar.",
  },
};
