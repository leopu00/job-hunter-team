-- 039: Position last_actor — istanza dell'ultimo agente che ha agito sulla posizione
-- Additive only — no data loss.
--
-- Perché: la pagina Team/Attività distingue le istanze per ruolo via colonne-attore
-- (found_by→scout-N, scores.scored_by→scorer-N, written_by→scrittore-N,
-- reviewed_by→critico-N), ma l'ANALISTA restava generico ("Analista") sul cloud.
-- A terra l'analista SCRIVE già la sua istanza: positions.last_actor (es. analista-4)
-- e companies.analyzed_by sono entrambe popolate sul DB del team. Nessuna delle due
-- arrivava al cloud: last_actor non era nello schema cloud né nel payload del push
-- (cloud-sync/push), e companies non è sincronizzata (Scope MVP, mapping UUID).
-- Questa colonna allinea il cloud al DB del team così che la sync porti analista-N.
-- last_checked (mig 003) resta come timestamp dell'ultimo richeck; last_actor è
-- l'ATTORE (istanza) corrispondente.

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS last_actor TEXT;
