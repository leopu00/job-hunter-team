import type { Locale } from "@/i18n/config";

export interface PageErrorText {
  title: string;
  /** Said under the title: the rest of the app works, and what to do. */
  body: string;
  retry: string;
  home: string;
}

/** What a page says when it breaks while it is drawn: the navbar and the other pages are still there. */
export const PAGE_ERROR_TEXT: Record<Locale, PageErrorText> = {
  it: { title: "Questa pagina ha avuto un problema", body: "Il resto dell'app funziona. Riprova, oppure torna alla dashboard.", retry: "Riprova", home: "Vai alla dashboard" },
  en: { title: "This page ran into a problem", body: "The rest of the app works. Try again, or go back to the dashboard.", retry: "Try again", home: "Go to the dashboard" },
  hu: { title: "Ezen az oldalon hiba történt", body: "Az alkalmazás többi része működik. Próbáld újra, vagy térj vissza az irányítópultra.", retry: "Újra", home: "Vissza az irányítópultra" },
  es: { title: "Esta página ha tenido un problema", body: "El resto de la app funciona. Inténtalo de nuevo o vuelve al panel.", retry: "Reintentar", home: "Ir al panel" },
  de: { title: "Diese Seite hatte ein Problem", body: "Der Rest der App funktioniert. Versuche es erneut oder gehe zurück zum Dashboard.", retry: "Erneut versuchen", home: "Zum Dashboard" },
  fr: { title: "Cette page a rencontré un problème", body: "Le reste de l'application fonctionne. Réessaie ou retourne au tableau de bord.", retry: "Réessayer", home: "Aller au tableau de bord" },
  pt: { title: "Esta página teve um problema", body: "O resto da app funciona. Tenta de novo ou volta ao painel.", retry: "Tentar de novo", home: "Ir para o painel" },
};
