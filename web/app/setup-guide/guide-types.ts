// Tipi della guida di setup a capitoli.
//
// Tre invarianti che il compilatore fa rispettare:
//
// 1. `GuideText = Record<Lang, string>` — ogni testo visibile esiste in tutte
//    e sette le lingue del sito. Una fase a cui manca il tedesco non compila,
//    invece di mostrare l'inglese a un utente tedesco (stessa logica di
//    `lib/i18n-dict.ts`, W03).
// 2. Le fasi non contengono immagini: contengono l'`id` di una schermata del
//    registro (`guide-screens.ts`). La stessa schermata può quindi comparire
//    in due fasi diverse — richiesta esplicita — senza duplicare l'asset né
//    la sua alt text.
// 3. Una fase dichiara per quali sistemi operativi vale (`os`). Il selettore
//    OS filtra le fasi; la numerazione mostrata all'utente è quella delle
//    fasi visibili per il SUO sistema, non degli id interni.

import type { Lang } from "../components/landing/LandingI18n";

/** Un testo visibile. Tutte e sette le lingue, garantite dal compilatore. */
export type GuideText = Record<Lang, string>;

/**
 * Un testo canonico inglese che **non è ancora tradotto**.
 *
 * Il copy delle fasi è di HQ-DOCS e arriva in inglese; la traduzione nelle
 * altre sei lingue è un lavoro a parte (HQ-FULLSTACK-1). Nel frattempo il
 * tipo pretende comunque sette valori, e riempirli a mano di inglese
 * renderebbe indistinguibile «tradotto» da «ancora da tradurre».
 *
 * Questo helper rende la lacuna esplicita e cercabile: chi traduce cerca
 * `untranslated(` e sostituisce la voce con le sette lingue vere. Il
 * comportamento a schermo è lo stesso fallback all'inglese che il sito usa
 * già ovunque — quello che cambia è che ora si sa quante ne mancano.
 */
export function untranslated(en: string): GuideText {
  return { en, it: en, es: en, fr: en, de: en, pt: en, hu: en };
}

/** Vero se il testo è ancora quello inglese in tutte e sette le lingue. */
export function isUntranslated(text: GuideText): boolean {
  return (Object.keys(text) as Lang[]).every((lang) => text[lang] === text.en);
}

/** I tre sistemi operativi supportati dalla guida. */
export type OsId = "macos" | "windows" | "linux";

export const OS_IDS: OsId[] = ["macos", "windows", "linux"];

/** Etichette del selettore OS — nomi propri, non si traducono. */
export const OS_LABELS: Record<OsId, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

/** Un file immagine concreto. Le dimensioni servono a `next/image` per
 *  riservare lo spazio ed evitare il salto di layout su mobile. */
export interface ScreenAsset {
  src: string;
  width: number;
  height: number;
}

/**
 * Una schermata della guida, come entità logica.
 *
 * `assets.shared` è la variante valida per tutti i sistemi; le chiavi per OS
 * la sovrascrivono quando la schermata è visibilmente diversa (una finestra
 * di Windows non è una finestra di macOS). Se per l'OS corrente non esiste
 * né la variante né `shared`, la pagina mostra uno slot vuoto con la
 * descrizione di `pending`: la guida resta leggibile e si vede a colpo
 * d'occhio cosa manca ancora da riprendere.
 */
export interface GuideScreen {
  id: string;
  /** Testo alternativo — descrive il contenuto, non «schermata». */
  alt: GuideText;
  /** Didascalia di default; una fase può sostituirla con la sua. */
  caption: GuideText;
  assets: { shared?: ScreenAsset } & Partial<Record<OsId, ScreenAsset>>;
  /** Cosa deve mostrare la schermata mancante. Nota di lavoro per chi la
   *  riprende: non viene mai mostrata all'utente finale. */
  pending?: string;
}

/** Riferimento a una schermata dentro una fase. */
export interface ScreenRef {
  screenId: string;
  /** Didascalia specifica di questa fase: serve proprio quando la stessa
   *  schermata compare due volte e va guardata con occhi diversi. */
  caption?: GuideText;
}

/** Quello che ogni link ha in comune. `os` limita il link a certi sistemi:
 *  su Windows ci sono due download ufficiali (installer e portable) che non
 *  esistono altrove, e mostrarli a chi sta su Linux confonde e basta. */
interface LinkBase {
  label: GuideText;
  os?: OsId[];
}

/** Un link operativo dentro una fase. */
export type GuideLink =
  /** Scarica l'app per l'OS selezionato: l'href lo risolve `guide-config`. */
  | (LinkBase & { kind: "download"; asset?: string })
  /** Risorsa esterna (Docker, provider…). L'href può variare per OS. */
  | (LinkBase & {
      kind: "external";
      href: string | Partial<Record<OsId, string>>;
    })
  /** Un'altra pagina del sito. */
  | (LinkBase & { kind: "internal"; href: string })
  /** Un comando da copiare. `label` descrive cosa fa. */
  | (LinkBase & { kind: "command"; command: string });

/** Vero se il link va mostrato per il sistema selezionato. */
export function linkAppliesTo(link: GuideLink, os: OsId): boolean {
  return !link.os || link.os.includes(os);
}

/** Una fase: un passo con la sua schermata (o due, quando una sola
 *  inquadratura non può provare lo stato — l'app collegata *e* la dashboard
 *  che mostra gli stessi dati). */
export interface GuidePhase {
  id: string;
  /** `"all"` oppure l'elenco dei sistemi in cui la fase compare. */
  os: OsId[] | "all";
  title: GuideText;
  body: GuideText;
  /** Avvertenza breve, evidenziata: il punto dove ci si blocca. */
  warning?: GuideText;
  screen?: ScreenRef | ScreenRef[];
  links?: GuideLink[];
}

/** Le schermate di una fase, sempre come elenco. */
export function screensOf(phase: GuidePhase): ScreenRef[] {
  if (!phase.screen) return [];
  return Array.isArray(phase.screen) ? phase.screen : [phase.screen];
}

/** Un capitolo: un gruppo di fasi con un esito dichiarato. */
export interface GuideChapter {
  id: string;
  title: GuideText;
  /** Una riga: cosa avrà ottenuto l'utente alla fine del capitolo. */
  summary: GuideText;
  phases: GuidePhase[];
}

/** Vero se la fase va mostrata per il sistema selezionato. */
export function phaseAppliesTo(phase: GuidePhase, os: OsId): boolean {
  return phase.os === "all" || phase.os.includes(os);
}

/** Le fasi di un capitolo visibili per il sistema selezionato. */
export function phasesFor(chapter: GuideChapter, os: OsId): GuidePhase[] {
  return chapter.phases.filter((phase) => phaseAppliesTo(phase, os));
}

/** L'asset da mostrare per questa schermata sul sistema selezionato, oppure
 *  `undefined` se non è ancora stato ripreso. */
export function assetFor(
  screen: GuideScreen,
  os: OsId,
): ScreenAsset | undefined {
  return screen.assets[os] ?? screen.assets.shared;
}
