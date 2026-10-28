import type { Locale } from "@/i18n/config";

/**
 * The words of the window that shows a CV or a cover letter inside the app. The title is the KIND of document,
 * never its file name (the name is personal data). `{n}` and `{total}` are numbers the caller fills in.
 */
export type DocumentPreviewCopy = {
  kindCv: string;
  kindLetter: string;
  tabsLabel: string;
  tabText: string;
  tabPdf: string;
  save: string;
  openInReader: string;
  close: string;
  loading: string;
  retry: string;
  /** Alternative text of one picture of a sheet. */
  sheetAlt: string;
  /** Said under the sheets when the document has more than the app shows. */
  sheetsCut: string;
  /** Said under the text when the document is longer than the app shows. */
  textCut: string;
  noText: string;
  saved: string;
  opened: string;
};

export const DOCUMENT_PREVIEW_TEXT: Record<Locale, DocumentPreviewCopy> = {
  it: {
    kindCv: "CV",
    kindLetter: "Lettera",
    tabsLabel: "Come mostrare il documento",
    tabText: "Testo",
    tabPdf: "PDF",
    save: "Salva con nome",
    openInReader: "Apri nel lettore",
    close: "Chiudi",
    loading: "Preparo l’anteprima…",
    retry: "Riprova",
    sheetAlt: "Foglio {n} di {total} del documento",
    sheetsCut: "Qui vedi i primi {n} fogli: salva il documento per averlo intero.",
    textCut: "Il testo è lungo: qui ne vedi una parte. Salva il documento per averlo intero.",
    noText: "Questo documento non ha una versione di testo.",
    saved: "Documento salvato.",
    opened: "Aperto nel lettore.",
  },
  en: {
    kindCv: "CV",
    kindLetter: "Cover letter",
    tabsLabel: "How to show the document",
    tabText: "Text",
    tabPdf: "PDF",
    save: "Save as",
    openInReader: "Open in reader",
    close: "Close",
    loading: "Preparing the preview…",
    retry: "Try again",
    sheetAlt: "Sheet {n} of {total} of the document",
    sheetsCut: "These are the first {n} sheets: save the document to have all of it.",
    textCut: "The text is long: only a part is shown here. Save the document to have all of it.",
    noText: "This document has no text version.",
    saved: "Document saved.",
    opened: "Opened in your reader.",
  },
  de: {
    kindCv: "Lebenslauf",
    kindLetter: "Anschreiben",
    tabsLabel: "Wie das Dokument gezeigt wird",
    tabText: "Text",
    tabPdf: "PDF",
    save: "Speichern unter",
    openInReader: "Im Reader öffnen",
    close: "Schließen",
    loading: "Vorschau wird vorbereitet…",
    retry: "Erneut versuchen",
    sheetAlt: "Seite {n} von {total} des Dokuments",
    sheetsCut: "Hier siehst du die ersten {n} Seiten: Speichere das Dokument, um es ganz zu haben.",
    textCut: "Der Text ist lang: Hier siehst du nur einen Teil. Speichere das Dokument, um es ganz zu haben.",
    noText: "Dieses Dokument hat keine Textversion.",
    saved: "Dokument gespeichert.",
    opened: "Im Reader geöffnet.",
  },
  fr: {
    kindCv: "CV",
    kindLetter: "Lettre",
    tabsLabel: "Comment afficher le document",
    tabText: "Texte",
    tabPdf: "PDF",
    save: "Enregistrer sous",
    openInReader: "Ouvrir dans le lecteur",
    close: "Fermer",
    loading: "Préparation de l’aperçu…",
    retry: "Réessayer",
    sheetAlt: "Page {n} sur {total} du document",
    sheetsCut: "Tu vois ici les {n} premières pages : enregistre le document pour l’avoir en entier.",
    textCut: "Le texte est long : tu n’en vois ici qu’une partie. Enregistre le document pour l’avoir en entier.",
    noText: "Ce document n’a pas de version texte.",
    saved: "Document enregistré.",
    opened: "Ouvert dans le lecteur.",
  },
  es: {
    kindCv: "CV",
    kindLetter: "Carta",
    tabsLabel: "Cómo mostrar el documento",
    tabText: "Texto",
    tabPdf: "PDF",
    save: "Guardar como",
    openInReader: "Abrir en el lector",
    close: "Cerrar",
    loading: "Preparando la vista previa…",
    retry: "Reintentar",
    sheetAlt: "Hoja {n} de {total} del documento",
    sheetsCut: "Aquí ves las primeras {n} hojas: guarda el documento para tenerlo entero.",
    textCut: "El texto es largo: aquí ves solo una parte. Guarda el documento para tenerlo entero.",
    noText: "Este documento no tiene versión de texto.",
    saved: "Documento guardado.",
    opened: "Abierto en el lector.",
  },
  pt: {
    kindCv: "CV",
    kindLetter: "Carta",
    tabsLabel: "Como mostrar o documento",
    tabText: "Texto",
    tabPdf: "PDF",
    save: "Guardar como",
    openInReader: "Abrir no leitor",
    close: "Fechar",
    loading: "A preparar a pré-visualização…",
    retry: "Tentar de novo",
    sheetAlt: "Folha {n} de {total} do documento",
    sheetsCut: "Aqui vês as primeiras {n} folhas: guarda o documento para o teres inteiro.",
    textCut: "O texto é longo: aqui vês só uma parte. Guarda o documento para o teres inteiro.",
    noText: "Este documento não tem versão de texto.",
    saved: "Documento guardado.",
    opened: "Aberto no leitor.",
  },
  hu: {
    kindCv: "Önéletrajz",
    kindLetter: "Levél",
    tabsLabel: "A dokumentum megjelenítése",
    tabText: "Szöveg",
    tabPdf: "PDF",
    save: "Mentés másként",
    openInReader: "Megnyitás olvasóban",
    close: "Bezárás",
    loading: "Előnézet előkészítése…",
    retry: "Újra",
    sheetAlt: "A dokumentum {n}. oldala a(z) {total} közül",
    sheetsCut: "Itt az első {n} oldalt látod: mentsd el a dokumentumot, hogy egészben megkapd.",
    textCut: "A szöveg hosszú: itt csak egy részét látod. Mentsd el a dokumentumot, hogy egészben megkapd.",
    noText: "Ennek a dokumentumnak nincs szöveges változata.",
    saved: "Dokumentum elmentve.",
    opened: "Megnyitva az olvasóban.",
  },
};
