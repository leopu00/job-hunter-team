-- 015_positions_location_max_length.sql
-- Hard cap su positions.location per evitare dump corrotti.
--
-- Incidente 2026-05-19: scout RobertHalf ha parsato male la pagina e ha
-- riversato ~4.4KB di markup HTML (JD intera) dentro la colonna location
-- (row a4ed4925-2e4e-4391-b565-a3af6ed29ef9). Risultato: la cella della
-- tabella positions in /positions sballava il layout, e i client SQLite
-- ricevevano la stessa stringa via cloud-sync.
--
-- Una location umana ragionevole è max ~80 char ("Company (EMEA) —
-- Europe/CET"). 200 char danno margine generoso senza permettere dump
-- multi-KB. Preferiamo rejectare che troncare: meglio uno scout che
-- fallisce visibilmente di un dato corrotto che passa silenzioso.

ALTER TABLE public.positions
    ADD CONSTRAINT positions_location_max_length
    CHECK (location IS NULL OR char_length(location) <= 200);
