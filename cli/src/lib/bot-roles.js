/**
 * I bot Telegram che esistono davvero, in un posto solo.
 *
 * ⚠️ Questa lista deve restare uguale a `BOT_ROLES` in
 * `agents/_tools/jht-notify-user`: chi non ha un bot proprio (Scout,
 * Analista, Scorer) parla da quello dell'Assistente, e passare `--from scout`
 * fa uscire `jht-telegram-send` con exit 1 — cioe' trasformerebbe
 * un'attribuzione sbagliata in un messaggio non consegnato (O-96).
 *
 * Le due copie sono in linguaggi diversi e non possono importarsi a vicenda;
 * a tenerle allineate c'e' un test che le legge entrambe dal sorgente.
 */
export const BOT_ROLES = ['assistente', 'capitano', 'mentor'];
export const DEFAULT_BOT_ROLE = 'assistente';
