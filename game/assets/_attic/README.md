# `_attic/` — arte fuori scena, conservata

Qui vive l'arte che **nessuna** riga di codice puo' piu' raggiungere: versioni
superate (`*_v1`, `*_v2`), contact sheet di lavorazione, ritratti in inglese
sostituiti dai loro equivalenti italiani, e arte consegnata per ambienti mai
costruiti (la sala relax: `rec_arcade`, `rec_pingpong`, `rec_sofa`,
`rug_lounge`, `kitchenette` — vedi `gen-art/LOG.md:158`).

**Non e' cestino.** Restano nel repo perche' sono ore di lavoro d'arte e
perche' la sala relax e' ancora un'idea aperta: riportarne un file in scena e'
un `mv` piu' un import.

## Come resta fuori dal build

Dai tre preset di `export_presets.cfg`, che portano lo stesso `exclude_filter`:

    *assets/_attic/*,*assets/characters/sources/*

Due pattern, non sedici. La versione precedente ne copiava sedici identici tre
volte, e bastava dimenticare **un** preset perche' imbarcasse cio' che gli
altri escludevano; ora c'e' una cosa sola da dire per cartella, e
`tools/asset_orphan_audit.py` si ferma se i tre preset divergono.

Il secondo pattern e' `characters/sources/`: non e' archivio, e' arte
**sorgente viva** (la usa `tools/build_character_variant_gallery.sh`), ma non e'
una risorsa di runtime e non deve pesare sul `.pck`.

> La via piu' pulita sarebbe un `.gdignore` in ognuna delle due cartelle: Godot
> le toglierebbe dal filesystem-risorse e sparirebbero import, `.import` e
> `uid://`. Il gancio `.githooks/pre-commit` non ammette l'estensione
> `gdignore` (ammette `gitignore`, `dockerignore`, `vercelignore`): finche'
> resta cosi', qui i `.import` ci sono e vanno versionati come altrove.

## Come si verifica che una cosa e' davvero orfana

`python3 tools/asset_orphan_audit.py`. Un grep del nome file **non basta**: in
questa scena i path si compongono a runtime (`furniture_node.gd:142,150`,
`character_defs.make_rig`, `ComicChat.portrait_slug`). L'audit riproduce quelle
regole e gira dentro `tools/run.sh test`.

## Come si ripesca un file

1. `mv assets/_attic/<sotto-path> assets/<sotto-path>`
2. referenzialo dal codice (o dagli un nome che una delle regole di
   composizione sappia produrre)
3. `tools/run.sh test` — l'audit torna verde da solo
