# Pipeline asset personaggi

## Sprite in-world (SVG a layer componibili)

- **Sorgente**: `assets/characters/src/build.py` — generatore Python che
  compone ogni personaggio da geometrie condivise (teste, capigliature,
  torsi per archetipo di abito, gamba singola) + palette per personaggio
  che imita i PNG di riferimento `web/public/agents-*.png`.
- **Output**: `assets/characters/gen/<slug>/<parte>_<direzione>.svg`
  - parti: `head`, `torso` (con braccia), `leg` (una gamba, riusata ×2)
  - direzioni: `front`, `side` (flippata via scale.x), `back` (solo testa:
    il torso frontale è simmetrico)
  - il Mentor non ha `leg_*`: la tunica copre le gambe (il rig fa ondeggiare
    il busto al posto dello swing).
- **Giocatore** (`gen/player/`): layer separati per essere combinati nel
  wizard — `head_<base>_<dir>` (3 basi di pelle), `torso_<base>_<dir>`
  (t-shirt), `hair_<stile>_<dir>` e `jacket_<dir>` **bianchi**: il rig li
  tinge con `modulate` (l'ombreggiatura è nera semi-trasparente e
  sopravvive alla tinta). Il giocatore è l'unico senza occhiali scuri.
- **Rigenerare**: `python3 assets/characters/src/build.py` (nessuna
  dipendenza). Poi in Godot: `godot --headless --import`.

## Import in Godot (nitidezza a 1080p)

Gli SVG sono rasterizzati all'import con `svg/scale = 2.0` (default di
progetto in `project.godot → [importer_defaults]`). Il `CharacterRig`
lavora quindi in pixel-texture (2×) e applica `scale = 0.5`: il risultato
è nitido anche su display retina/fullscreen.

## Rig (scenes runtime, nessuna scena .tscn per i personaggi)

`scripts/characters/character_rig.gd` impila i layer (gamba ×2, torso,
giacca, testa, capelli) con origine ai piedi e anima via codice:

- `walk`: swing opposto delle gambe (rotazione attorno all'anca) + bob;
- `work`: micro-bob veloce del busto (digitazione);
- `idle`: respiro sinusoidale lento;
- direzioni: `down` / `up` / `side` (+ flip orizzontale).

## Ritratti da dialogo

Vedi `assets/characters/portraits/` (M3): mezzo busto grande per il
dialogo, layer corpo-posa × faccia-espressione, generati da
`src/build_portraits.py` con lo stesso principio dei layer componibili.

**Copertura ritratti dipinti (22/07): 11 ruoli su 11.** Oltre ad
assistente, coordinatore, scout, scorer, analista e mentor, sono ora
disponibili anche scrittore, critico, sentinella, dottore e mantenitore.
Ogni ruolo ha `full_neutro.png` e tutte le espressioni effettivamente usate
dal proprio albero in `scripts/dialogue/dialogues.gd`; il runner può quindi
aprire ogni dialogo diretto senza fallback vuoti.
