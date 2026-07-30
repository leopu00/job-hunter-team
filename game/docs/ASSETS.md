# Pipeline asset personaggi

## Sprite in-world (spritesheet pittorici)

Gli agenti in scena sono **spritesheet dipinti**, uno per identità. Il
contratto del foglio (griglia, cella, tracce, piedi) è in
[`SPRITES.md`](SPRITES.md) — questa pagina dice solo dove vivono i file.

- **File**: `assets/characters/sheets/<slug>_<variante>.png`
  - `<slug>`: il ruolo (`scout`, `analista`, `scorer`, `scrittore`,
    `critico`, `coordinatore`, `assistente`, `mentor`, `dottore`,
    `sentinella`, `maintainer`)
  - `<variante>`: `a`…`f`, una per postazione del reparto
    (`CharacterDefs.VARIANT_BY_DESK`); `a` è il lead del ruolo
  - `<slug>_<variante>_sit.png` è il foglio seduto, **opzionale**: se manca,
    `SpriteSheetRig` degrada `sit` a `work` da solo
- **Sorgenti d'arte**: `assets/characters/sources/` (con `.gdignore`: non
  vengono importate né esportate). Le usa
  `tools/build_character_variant_gallery.sh` per il contact sheet di
  revisione.
- **Ruolo senza foglio**: `CharacterDefs.make_rig()` scala su
  `<slug>_a.png` e, se non esiste nemmeno quello,
  su `CharacterDefs.FALLBACK_SHEET` (`scout_a`) con un `push_warning`. Un
  ruolo nuovo entra quindi in scena vestito da Scout — mai invisibile.
- **Prestiti**: `CharacterDefs.SHEET_LOANS` (oggi solo
  `mantenitore → maintainer`).

> **La pipeline SVG a layer non esiste più.** `character_rig.gd`,
> `agent_textures()` e il generatore `src/build.py` producevano
> `assets/characters/gen/<slug>/<parte>_<direzione>.svg`; da quando ogni slug
> del roster ha il proprio foglio `_a`, quel ramo non veniva più eseguito.
> Codice rimosso, arte conservata in
> [`assets/_attic/characters/`](../assets/_attic/README.md). Se cerchi come si
> disegna un agente, il posto giusto è `SPRITES.md`, non un generatore Python.
> Restano vivi i **ritratti** in `assets/characters/gen/portraits/` (vedi sotto).

## Import in Godot (nitidezza a 1080p)

I fogli sono PNG: nessuna rasterizzazione all'import. La resa in scena la
decide `SpriteSheetRig.RIG_SCALE` (0.425 su celle 256×384), calibrata perché
un agente stia in scala con gli arredi.

Gli SVG rimasti sono i **ritratti da dialogo**, rasterizzati all'import con
`svg/scale = 2.0` (default di progetto in `project.godot →
[importer_defaults]`): `PortraitView` lavora in pixel-texture 2× e rimpicciolisce,
così il ritratto resta nitido su display retina.

## Rig (costruito a runtime, nessuna scena .tscn per i personaggi)

`scripts/characters/sprite_sheet_rig.gd` sceglie riga e frame del foglio in
base a `set_motion(facing, flipped, mode)`:

- `idle` / `still` / `walk` / `work` / `carry` sul foglio principale;
- `sit` / `sit_idle` sul foglio `_sit`, se consegnato;
- direzioni `down` / `up` / `side` (+ flip orizzontale per `left`/`right`).

Chi chiama non sa quale foglio è stato caricato: l'API è solo `set_motion`.

## Ritratti da dialogo

Due famiglie, con questa precedenza (`PortraitView.setup`):

1. **pittorici** `assets/gen-art/portraits/<ruolo>[-<n>]/full_<emozione>.png`
   — vincono se il PNG carica davvero;
2. **SVG a layer** `assets/characters/gen/portraits/<ruolo>/base.svg`
   + `pose_*.svg` / `face_*.svg`, generati da
   `assets/characters/src/build_portraits.py`. **Questa pipeline è viva**: è
   l'unico uso rimasto degli SVG a layer.

`ComicChat.portrait_slug()` risolve l'uid di gioco alla cartella: prima
l'istanza (`scout-2`), poi il ruolo, togliendo un suffisso alla volta.

**Copertura ritratti dipinti (22/07): 11 ruoli su 11.** Oltre ad
assistente, coordinatore, scout, scorer, analista e mentor, sono ora
disponibili anche scrittore, critico, sentinella, dottore e mantenitore.
Ogni ruolo ha `full_neutro.png` e tutte le espressioni effettivamente usate
dal proprio albero in `scripts/dialogue/dialogues.gd`; il runner può quindi
aprire ogni dialogo diretto senza fallback vuoti.
