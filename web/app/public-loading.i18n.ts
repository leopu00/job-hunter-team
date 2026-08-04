import type { Locale } from "@/i18n/config";

export const PUBLIC_LOADING_COPY: Record<
  Locale,
  { status: string; promise: string; recovery: string }
> = {
  it: {
    status: "Stiamo preparando la pagina",
    promise: "Una squadra di agenti AI per la tua ricerca di lavoro.",
    recovery: "Se la pagina non appare tra qualche istante, ricaricala.",
  },
  en: {
    status: "Preparing the page",
    promise: "A team of AI agents for your job search.",
    recovery: "If the page does not appear shortly, reload it.",
  },
  hu: {
    status: "Az oldal előkészítése",
    promise: "AI-ügynökök csapata az álláskeresésedhez.",
    recovery: "Ha az oldal nem jelenik meg hamarosan, töltsd újra.",
  },
  es: {
    status: "Preparando la página",
    promise: "Un equipo de agentes de IA para tu búsqueda de empleo.",
    recovery: "Si la página no aparece en unos instantes, vuelve a cargarla.",
  },
  de: {
    status: "Seite wird vorbereitet",
    promise: "Ein Team aus KI-Agenten für deine Jobsuche.",
    recovery: "Wenn die Seite in Kürze nicht erscheint, lade sie neu.",
  },
  fr: {
    status: "Préparation de la page",
    promise: "Une équipe d’agents IA pour votre recherche d’emploi.",
    recovery: "Si la page ne s’affiche pas dans un instant, rechargez-la.",
  },
  pt: {
    status: "A preparar a página",
    promise: "Uma equipa de agentes de IA para a sua procura de emprego.",
    recovery: "Se a página não aparecer em breve, atualize-a.",
  },
};
