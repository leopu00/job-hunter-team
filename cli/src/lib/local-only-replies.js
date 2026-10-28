/**
 * local-only-replies.js — la risposta libera a una domanda semplice resta sul Mac.
 *
 * Una domanda semplice è `jht-notify-user --kind question "testo"`: nessuna opzione, nessun
 * `source_action`. La persona risponde scrivendo nella chat, e `close_plain_questions`
 * (shared/skills/agent_chat.py) copia quel testo — qualunque messaggio, fino a 4000
 * caratteri — in `user_reply` della domanda. Le domande strutturate scrivono in `user_reply`
 * solo le etichette e la closer un segnaposto: il testo libero non esce mai da lì.
 * Per le domande semplici `user_reply` È il testo libero, e il sync lo porterebbe al cloud
 * (e da lì nell'export dell'account).
 *
 * Il testo serve in locale (la card della risposta, `jht-check-user-replies` se la consegna
 * al terminale non è provata): resta nel jobs.db. Nei due punti da cui le righe partono
 * verso il cloud — il full-push di `jht cloud` e la corsia veloce di chat-sync.js — queste
 * righe escono con i tre campi della risposta a NULL. Il cloud non ne perde: il merge
 * (mig 057/060) tiene il valore che ha già, quindi una risposta data dal web resta là.
 */

/** La condizione SQL delle domande semplici dell'agente. `has(colonna)` dice se lo schema locale la ha. */
export function plainQuestionCondition(has) {
  const parts = ["kind = 'question'"];
  if (has("author")) parts.push("author = 'agent'");
  if (has("source_action")) parts.push("COALESCE(source_action, '') = ''");
  return parts.join(" AND ");
}

const REPLY_COLUMNS = ["user_reply", "user_reply_at", "agent_seen_reply_at"];

/** I tre campi della risposta come SELECT: NULL per le domande semplici, il valore vero per ogni altra riga. */
export function replyColumnsForCloud(has) {
  const condition = plainQuestionCondition(has);
  return REPLY_COLUMNS.map(
    (column) => `CASE WHEN ${condition} THEN NULL ELSE ${column} END AS ${column}`,
  );
}
