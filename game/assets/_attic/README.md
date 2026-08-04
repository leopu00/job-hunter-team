# `_attic/` — arte fuori scena, conservata

Qui vive l'arte che **nessuna** riga di codice puo' piu' raggiungere: versioni
superate (`*_v1`, `*_v2`), contact sheet di lavorazione, ritratti in inglese
sostituiti dai loro equivalenti italiani, e arte consegnata per ambienti mai
costruiti (la sala relax: `rec_arcade`, `rec_pingpong`, `rec_sofa`,
`rug_lounge`, `kitchenette` — vedi `gen-art/LOG.md:158`).

**Non e' cestino.** Restano nel repo perche' sono ore di lavoro d'arte e
perche' la sala relax e' ancora un'idea aperta: riportarne un file in scena e'
un `mv` piu' un import.

Un avvertimento sui riferimenti: qui dentro **non ci sono `.import`**, quindi
questi file non hanno un `uid://` e nessuna scena puo' puntarli. Un percorso
`res://assets/_attic/...` scritto a mano in un `.tscn` o in un `.gd` non
risolve: prima si sposta il file fuori (vedi in fondo), poi lo si referenzia.

## Come resta fuori dal build

Dal file `.gdignore` che sta qui accanto. Godot non scandisce affatto una
cartella che lo contiene: qui dentro **non esistono risorse**, quindi niente
import, niente `.import`, niente `uid://` e niente da escludere a valle. Il
contenuto del file non viene letto: conta solo che esista.

Prima al suo posto c'era un pattern `*assets/_attic/*` in `exclude_filter`, che
teneva fuori dal `.pck` file che Godot importava comunque: 178 `.import`
versionati e ~107 MB di `.godot/imported` rigenerati a ogni cache fredda, per
descrivere arte che nessuno carica. Il pattern e' stato rimosso il 2026-08-03
dopo due export a confronto — **950 file e 459.600.512 byte esatti in entrambi**
— quindi sul prodotto non cambia nulla: il guadagno e' tutto nel working tree e
nei tempi di reimport (~19% di CPU in meno su un import da zero).

In `exclude_filter` resta un pattern solo, `*assets/characters/sources/*`: non
e' archivio, e' arte **sorgente viva** (la usa
`tools/build_character_variant_gallery.sh`), quindi deve restare una risorsa
scandita, ma non deve pesare sul `.pck`. Un pattern per cartella, uguale nei tre
preset, e `tools/asset_orphan_audit.py` si ferma se i tre divergono.

> ⚠️ Non toccare `include_filter="*scripts/backend/payloads/*"`: senza, i
> payload Python non entrano nel `.pck` e il gioco esportato smette di parlare
> con la VPS **in silenzio** (`scripts/backend/vps_backend.gd:62`).

## Come si verifica che una cosa e' davvero orfana

`python3 tools/asset_orphan_audit.py`. Un grep del nome file **non basta**: in
questa scena i path si compongono a runtime (`furniture_node.gd:142,150`,
`character_defs.make_rig`, `ComicChat.portrait_slug`). L'audit riproduce quelle
regole e gira dentro `tools/run.sh test`.

## Come si ripesca un file

1. `mv assets/_attic/<sotto-path> assets/<sotto-path>` — fuori di qui torna a
   essere una risorsa: `tools/run.sh` lo importa da solo e gli genera `.import`
   e `uid://`, che vanno versionati come per ogni altro asset
2. referenzialo dal codice (o dagli un nome che una delle regole di
   composizione sappia produrre)
3. `tools/run.sh test` — l'audit torna verde da solo
