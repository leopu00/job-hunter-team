-- O-70 — la rivalutazione usa position_tickets, non una coda parallela.
-- Una posizione può avere una sola richiesta rescore ancora open/assigned;
-- i ticket resolved restano nello storico e non impediscono di richiederne
-- una nuova in futuro. Specchio SQLite: shared/skills/_db.py.

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_tickets_active_rescore
    ON position_tickets(user_id, position_legacy_id, kind)
    WHERE kind = 'rescore' AND status IN ('open', 'assigned');
