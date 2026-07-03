# chronicles-v1 — archivio

Pagina pubblica `/chronicles` ("Cronache del Team") e le sue storie. **Tolta dal
sito pubblico**, conservata qui perché potrebbe tornare utile.

## Perché è stata archiviata

Le storie (Capitano che diventa "zombie", Sentinella che "fa fuoco" sul team,
ecc.) sono **ironiche e volutamente romanzate** di banali inciampi tecnici — ma
fuori contesto, per il grande pubblico, possono dare un **hype negativo**
("allora questi agenti AI sono pericolosi / fuori controllo"). Per la prima
versione pubblica preferiamo non confondere chi non conosce il progetto. Non è
buttata: si può ripescare e ri-pubblicare quando ha senso.

## Cosa c'è qui

- `app/` — la route Next completa: `page.tsx` (indice), `stories.ts`, e le
  quattro storie pubblicate (`zombie-night`, `bipolar-sentinel`,
  `scout-and-london`, `week-nobody-saw`) con i rispettivi `layout.tsx`/`page.tsx`.
- `public-images/` — le cover delle storie (`<slug>.png`).
- `chronicles-canon.md` — il canone narrativo (cornice, cast, glossario
  tecnico→narrativo, stile copertine, backlog storie + episodi candidati).
  Spostato qui da `docs/internal/` il 2026-07-03: vive e muore con la pagina.
  Nota: la tabella "cast" (attributi scenici per ruolo) è ancora consultata da
  `docs/internal/landing-image-prompts.md` per le immagini di `/agents`.

## Come riprenderla

Riportare `app/` sotto `web/app/chronicles/` e `public-images/` sotto
`web/public/chronicles/`, poi rimettere i due link `nav_chronicles` in
`web/app/components/landing/LandingNav.tsx` (desktop + mobile).

## Nota sull'immagine del cubo

`the-box.png` (il cubo isometrico con gli osservatori) **non** è qui: è stata
spostata in `web/public/the-box.png` e **riusata nella pagina `/project`** come
immagine del progetto.
