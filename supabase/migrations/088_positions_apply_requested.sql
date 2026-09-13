-- 088_positions_apply_requested.sql
-- [JHT-CLOSER] fase A — l'AUTORIZZAZIONE PER-POSIZIONE alla candidatura.
--
-- Il CLOSER copre il salto `ready -> applied`, che finora faceva l'umano a
-- mano. Perché non lo faccia mai da solo servono DUE condizioni, entrambe
-- fail-closed: il consenso generale nella configurazione utente e il flag di
-- QUESTA posizione, che è ciò che queste colonne registrano. Manca il flag =
-- nessun invio, qualunque sia lo score.
--
-- Stesso pattern desired-state di write_requested (mig 024) /
-- geocode_requested (027) / recheck_requested (042) / salary_precise_requested,
-- e per la stessa ragione pratica: l'operatore sta su una VPS e flagga dalla
-- dashboard web, quindi l'intenzione nasce sul cloud e deve scendere al box
-- via `pull-desired-state`. Riusare la corsia che esiste invece di aprirne una
-- seconda è il punto: una corsia nuova sarebbe un secondo posto in cui
-- l'autorizzazione può perdersi.
--
-- ⚠️ `apply_requested_by` NON è un ornamento e non è ridondante rispetto a
-- `apply_requested_at`. Vale la regola di [APPLIED-STATE-NEVER-COMES-HOME]
-- (#186): dal cloud si prende l'AZIONE DELL'UTENTE, mai lo stato generico. Un
-- flag booleano da solo non dice se l'ha acceso una persona o un processo, e
-- un'autorizzazione di cui non si sa chi l'ha data non è un'autorizzazione: è
-- un valore in una colonna. Il vocabolario lo fa rispettare il codice
-- (`shared/skills/apply_gate.py`), che accetta solo `user_web` e `user_local`
-- e rifiuta tutto il resto — CLOSER compreso.
--
-- Nessun CHECK sul valore, deliberatamente e come per `rejection_reason`
-- (mig 087): un canale nuovo (Telegram, gioco) deve costare una riga di
-- vocabolario, non un'altra migrazione. Il prezzo è che il gate è l'unico
-- posto che rifiuta un valore sconosciuto, ed è scritto per rifiutarlo.
--
-- Mirror SQLite: shared/skills/_db.py::_migrate_positions_apply_requested.

ALTER TABLE public.positions
    ADD COLUMN IF NOT EXISTS apply_requested BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS apply_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS apply_requested_by TEXT;

COMMENT ON COLUMN public.positions.apply_requested IS
    '[JHT-CLOSER] autorizzazione per-posizione alla candidatura. Default false: assente = disattivato, sempre.';
COMMENT ON COLUMN public.positions.apply_requested_at IS
    '[JHT-CLOSER] quando l''utente ha autorizzato. Cursore dell''azione per pull-desired-state (#186).';
COMMENT ON COLUMN public.positions.apply_requested_by IS
    '[JHT-CLOSER] CHI ha autorizzato: user_web | user_local. Vocabolario in shared/skills/apply_gate.py (nessun CHECK: un canale nuovo non deve costare una migrazione).';

-- Indice parziale come per gli altri quattro flag: la coda che interessa è
-- «quali posizioni sono autorizzate», mai «quali non lo sono».
CREATE INDEX IF NOT EXISTS idx_positions_apply_requested
    ON public.positions(apply_requested) WHERE apply_requested;
