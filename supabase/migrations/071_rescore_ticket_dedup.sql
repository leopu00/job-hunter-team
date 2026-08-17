-- O-70 — la rivalutazione usa position_tickets, non una coda parallela.
-- Una posizione può avere una sola richiesta rescore ancora open/assigned;
-- i ticket resolved restano nello storico e non impediscono di richiederne
-- una nuova in futuro. Specchio SQLite: shared/skills/_db.py.
--
-- `kind` era già testo libero prima di questa migrazione: eventuali rescore
-- legacy duplicati vanno sanati PRIMA dell'indice, altrimenti una sola coppia
-- blocca l'intera migrazione per tutti gli utenti. Non cancelliamo nulla:
-- resta attivo prima un ticket già assigned, poi il più antico (id spareggio);
-- gli altri passano a resolved conservando richiesta, risposta e assegnatario.

WITH ranked_active_rescores AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, position_legacy_id, kind
               ORDER BY CASE status WHEN 'assigned' THEN 0 ELSE 1 END,
                        created_at ASC,
                        id ASC
           ) AS active_rank
      FROM position_tickets
     WHERE kind = 'rescore'
       AND status IN ('open', 'assigned')
)
UPDATE position_tickets AS ticket
   SET status = 'resolved',
       resolved_at = COALESCE(ticket.resolved_at, now()),
       updated_at = now()
  FROM ranked_active_rescores AS ranked
 WHERE ticket.id = ranked.id
   AND ranked.active_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_tickets_active_rescore
    ON position_tickets(user_id, position_legacy_id, kind)
    WHERE kind = 'rescore' AND status IN ('open', 'assigned');
