/**
 * «Mi sono candidato»: chi l'ha deciso, e cosa se ne fa l'altra sponda.
 *
 * Vive in `shared/` per la stessa ragione di `receipt-ids.js`: la regola la
 * applicano due programmi. La route del sito la usa per SCRIVERE la
 * candidatura manuale (`mark-applied`), il box per RIPORTARLA a casa
 * (`cli/src/lib/applied-backflow.js`). Due copie divergono al primo cambio, e
 * qui divergere significa che il box e il sito raccontano due storie diverse
 * sulla stessa candidatura — che e' esattamente il difetto di #186 visto da
 * vicino.
 *
 * JS puro con JSDoc, cosi' lo importano sia il CLI (ESM) sia il web
 * (`allowJs`), come gia' fa `shared/release/version.js`.
 */

/**
 * Il marchio della candidatura mandata dall'utente a mano.
 *
 * Non e' un dettaglio di formato: e' l'unico modo per distinguere una
 * candidatura che l'utente ha spedito dal sito dell'azienda da una che ha
 * spedito il team. Le due non si possono toccare allo stesso modo — annullare
 * quella del team significa dirgli una cosa falsa sul proprio lavoro.
 */
export const APPLIED_VIA_USER = "user_manual";

/**
 * Gli stati in cui una candidatura è già partita.
 *
 * `response` è la progressione di `applied`, non il suo contrario: la
 * candidatura è stata mandata davvero, e l'azienda ha risposto. Una corsia che
 * chiede «lo stato è applied?» invece di «il box è almeno a questo punto?»
 * tratta il secondo come un ritardo da recuperare e riporta indietro il primo.
 */
export const POST_SUBMISSION_STATES = ["applied", "response"];

/**
 * Lo stato plausibile a cui tornare quando la transizione non c'e'.
 *
 * Si usa SOLO come ripiego: lo stato vero e' quello registrato nella
 * transizione che ha portato ad `applied`, ed e' un dato, non una
 * ricostruzione. Il ripiego serve ai box mai sincronizzati e alle righe
 * potate, e segue l'ordine in cui il team produce i fatti.
 *
 * @param {boolean} hasCv   esiste un CV scritto per questa posizione
 * @param {boolean} hasScore esiste un punteggio
 * @returns {string}
 */
export function derivedPreviousState(hasCv, hasScore) {
  if (hasCv) return "ready";
  if (hasScore) return "scored";
  return "new";
}

/**
 * @typedef {object} AppliedSide
 * @property {boolean} applied      la candidatura risulta inviata
 * @property {string|null} [appliedVia] chi l'ha inviata
 * @property {string|null} [status]  stato della posizione (solo lato box)
 */

/**
 * Cosa deve fare il box di una candidatura che gli arriva dal cloud.
 *
 * Il criterio e' quello che la corsia applica gia' all'esclusione utente, e
 * che questa riga estende senza cambiarlo: **dal cloud si prende l'AZIONE
 * DELL'UTENTE, mai lo stato generico**, che resta autoritativo sul box. Per
 * l'esclusione l'azione si riconosce da `user_excluded_at`; per la
 * candidatura da `applied_via = user_manual`, che dice anche CHI.
 *
 * Tutti i verdetti sono idempotenti per costruzione: la corsia gira a ogni
 * tick del daemon e deve poter rivedere la stessa riga senza riscriverla.
 *
 * @param {{cloud: AppliedSide, local: AppliedSide|null}} sides
 * @returns {{action: 'apply'|'undo'|'skip', reason: string}}
 */
export function decideAppliedBackflow({ cloud, local }) {
  // Una posizione che il box non ha: la riga e' nata su un altro device e
  // arrivera' col suo push completo. Crearla qui con la sola candidatura
  // produrrebbe una riga zoppa (NULL su title/company) che il CHECK rifiuta —
  // stessa scelta gia' presa per i flag desired-state.
  if (!local) return { action: "skip", reason: "position_not_local" };

  const localAppliedByUser =
    Boolean(local.applied) && local.appliedVia === APPLIED_VIA_USER;
  const localAppliedByTeam =
    Boolean(local.applied) && Boolean(local.appliedVia) && !localAppliedByUser;

  if (cloud.applied) {
    // Una candidatura che il cloud attribuisce al team non e' mai una novita':
    // sul cloud ci e' arrivata dal box, quindi il box la sa gia'.
    if (cloud.appliedVia !== APPLIED_VIA_USER) {
      return { action: "skip", reason: "not_a_user_action" };
    }
    if (localAppliedByTeam) {
      return { action: "skip", reason: "applied_by_team" };
    }
    // `response` sta qui accanto a `applied` e NON è un caso in più: è lo
    // stato in cui la stessa candidatura si trova DOPO, quando l'azienda ha
    // risposto (#187). Senza, il verdetto cadeva su `apply` e la corsia
    // riportava indietro a `applied` un esito che il box aveva già registrato
    // — cancellando lo stato su entrambi i lati, perché poi il push lo
    // rimanda al cloud e il trigger dell'invariante lascia passare `applied`.
    //
    // Chi domani aggiunge un altro stato post-invio deve aggiungerlo QUI: la
    // domanda che questa riga pone non è «è applied?» ma «il box è già almeno
    // avanti quanto il cloud?».
    if (localAppliedByUser && POST_SUBMISSION_STATES.includes(local.status)) {
      return { action: "skip", reason: "already_applied" };
    }
    return { action: "apply", reason: "user_applied_on_web" };
  }

  // Verso opposto: l'utente ha annullato dal sito. Si annulla solo cio' che
  // l'utente stesso aveva mandato, e solo se il box e' ancora fermo li' — se
  // nel frattempo e' arrivata una risposta dell'azienda o un'esclusione, quel
  // cambio e' piu' recente e non lo si calpesta.
  if (localAppliedByUser && local.status === "applied") {
    return { action: "undo", reason: "user_undid_on_web" };
  }
  return { action: "skip", reason: "nothing_to_undo" };
}

/**
 * @typedef {object} OutcomeSide
 * @property {string|null} [response]   l'esito: interview · rejected · ghosted
 * @property {string|null} [responseAt] quando è stato registrato
 */

/**
 * Cosa deve fare il box dell'ESITO che gli arriva dal cloud (#187).
 *
 * Vive accanto alla decisione sulla candidatura perché è la stessa corsia e la
 * stessa regola — dal cloud si prende l'azione dell'utente — ma è un giudizio
 * separato: la candidatura risponde a «è partita?», l'esito a «com'è andata?»,
 * e confonderli è come sono nate le righe che sanno la data di una risposta
 * che non sanno nominare.
 *
 * Il caso che decide la forma: il box può avere un esito PIÙ RECENTE del
 * cloud, scritto dal team via CLI. Riportare indietro quello vecchio sarebbe
 * lo stesso difetto al contrario, quindi a parità di dubbio non si scrive.
 *
 * @param {{cloud: OutcomeSide, local: (OutcomeSide|null)}} sides
 * @returns {{action: 'write'|'skip', reason: string}}
 */
export function decideOutcomeBackflow({ cloud, local }) {
  if (!local) return { action: "skip", reason: "position_not_local" };

  const outcome = cloud?.response ?? null;
  if (!outcome) return { action: "skip", reason: "no_outcome_on_cloud" };
  if (!local.response) {
    return { action: "write", reason: "outcome_declared_on_web" };
  }
  if (local.response === outcome) {
    return { action: "skip", reason: "already_recorded" };
  }

  // ⚠️ I due istanti arrivano in formati diversi — il cloud in ISO con la `T`,
  // il box in `YYYY-MM-DD HH:MM:SS` di `datetime('now','localtime')` — e un
  // confronto fra stringhe direbbe SEMPRE che il cloud è più recente, perché
  // 'T' > ' '. Si confrontano come istanti, e se uno dei due non è leggibile
  // non si tocca niente: un esito sbagliato è peggio di un esito in ritardo.
  const cloudAt = Date.parse(cloud.responseAt ?? "");
  const localAt = Date.parse(local.responseAt ?? "");
  if (Number.isNaN(cloudAt) || Number.isNaN(localAt)) {
    return { action: "skip", reason: "outcome_age_unknown" };
  }
  if (cloudAt > localAt) {
    return { action: "write", reason: "newer_outcome_on_web" };
  }
  return { action: "skip", reason: "local_outcome_not_older" };
}
