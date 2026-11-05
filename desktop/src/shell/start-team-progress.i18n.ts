import type { Locale } from "@/i18n/config";

/** What the page says while «start the team» runs: the step it is at, how long it has been, and where it stopped. */
export interface StartTeamProgressCopy {
  /** Before the first step is known. */
  preparing: string;
  /** «Step {n} of {m}». */
  stepOf: string;
  /** The start is done and the page looks for its data again. */
  loading: string;
  /** A failure: «{step}» is the step it stopped at, «{n}» and «{m}» its place. */
  stoppedAt: string;
  /** A failure before any step began. */
  stoppedEarly: string;
}

export const START_TEAM_PROGRESS_TEXT: Record<Locale, StartTeamProgressCopy> = {
  it: { preparing: "Preparazione dell’avvio", stepOf: "Passo {n} di {m}", loading: "Squadra accesa: leggo i dati", stoppedAt: "Si è fermato al passo {n} di {m}: {step}.", stoppedEarly: "Si è fermato prima di cominciare." },
  en: { preparing: "Getting ready to start", stepOf: "Step {n} of {m}", loading: "Team is up: reading its data", stoppedAt: "It stopped at step {n} of {m}: {step}.", stoppedEarly: "It stopped before it began." },
  de: { preparing: "Der Start wird vorbereitet", stepOf: "Schritt {n} von {m}", loading: "Team läuft: Daten werden gelesen", stoppedAt: "Es ist bei Schritt {n} von {m} stehen geblieben: {step}.", stoppedEarly: "Es ist stehen geblieben, bevor es begann." },
  es: { preparing: "Preparando el inicio", stepOf: "Paso {n} de {m}", loading: "Equipo en marcha: leyendo sus datos", stoppedAt: "Se detuvo en el paso {n} de {m}: {step}.", stoppedEarly: "Se detuvo antes de empezar." },
  fr: { preparing: "Préparation du démarrage", stepOf: "Étape {n} sur {m}", loading: "Équipe lancée : lecture de ses données", stoppedAt: "Il s’est arrêté à l’étape {n} sur {m} : {step}.", stoppedEarly: "Il s’est arrêté avant de commencer." },
  hu: { preparing: "Az indítás előkészítése", stepOf: "{n}. lépés / {m}", loading: "A csapat fut: az adatok beolvasása", stoppedAt: "A(z) {n}. lépésnél állt meg ({m} lépésből): {step}.", stoppedEarly: "Megállt, mielőtt elkezdődött volna." },
  pt: { preparing: "A preparar o arranque", stepOf: "Passo {n} de {m}", loading: "Equipa a funcionar: a ler os dados", stoppedAt: "Parou no passo {n} de {m}: {step}.", stoppedEarly: "Parou antes de começar." },
};
