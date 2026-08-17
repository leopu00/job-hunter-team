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
    if (localAppliedByUser && local.status === "applied") {
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
