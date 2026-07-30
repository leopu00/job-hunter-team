# Video di presentazione JHT — scaletta (~59 s · senza audio · testi in INGLESE)

Due montaggi dalla STESSA scaletta e dalle STESSE riprese:

- **orizzontale** 1280×720 — `make_presentation.py` → `jht-presentation.mp4`
- **verticale** 9:16 720×1280 (cellulare) — `make_vertical.py` →
  `jht-presentation-vertical.mp4`. Non è un ritaglio centrale: ogni scena è
  ricomposta per la colonna stretta e nelle riprese del gioco il ritaglio
  SEGUE il soggetto (replica del percorso camera della regia).

Impianto PIL + ffmpeg ripreso dal promo v0.2.0; verticale impostato sulla
lezione di `regia/lanci/2026-07-v0.2.0/promo-video/make_tiktok.py`. Tre
scene sono **riprese vere del gioco** registrate con la Movie Maker mode di
Godot (`record_clips.sh` + `game/tools/promo_director.gd`): rendering
fotogramma per fotogramma, deterministico, niente cattura schermo.
Transizioni: xfade 0,5 s tra ogni scena.

**Regola d'oro delle riprese (feedback utente 30/07: «si vede molto poco»):
la camera sta ADDOSSO agli agenti.** Campo largo solo come apertura breve
(~1,5 s montati); il resto della scena vive a zoom ≥ 1.95, dove un agente è
alto ~150 px e una vignetta si legge anche a 720p su un telefono.

| # | Tempo | Scena | Contenuto a schermo |
|---|-------|-------|---------------------|
| 1 | 0:00–0:04 | Hook | "Job hunting is a second job." + le tre incombenze quotidiane |
| 2 | 0:04–0:08 | Reveal | Wordmark "Job Hunter Team" · "a team of AI agents that hunts jobs for you" · `$ jht team start` con cursore |
| 3 | 0:08–0:12 | La squadra | Illustrazione della riunione (landing-hero) con Ken Burns · "A real team: clear roles, a Captain, a weekly budget to respect." |
| 4 | 0:12–0:14 | The Scouts | Ritratto + "They sweep the job boards. Day and night." · barra pipeline |
| 5 | 0:14–0:17 | The Analysts | "They read every posting. They extract what matters." |
| 6 | 0:17–0:19 | The Scorers | "A score for every position: how well it fits you, 0-100." + badge animato 0→84/100 |
| 7 | 0:19–0:26 | **RIPRESA VERA — reparto Scrittori** | Campo stretto (zoom 2.05→2.18) sulle due scrivanie occupate, lenta carrellata; vignette inglesi sui CV · didascalie Writers/Critics su pastiglia |
| 8 | 0:26–0:35 | **RIPRESA VERA — l'ufficio** (il punto emotivo) | ~1,5 s di totale (fit larghezza), poi SPINTA dentro il Research fino a due Scout a zoom ~2 col globo olografico; vignette leggibili · "Not a dashboard: an office, inside a video game." → "Watch them work for you, while you do something else." |
| 9 | 0:35–0:44 | **RIPRESA VERA — la chat** | Pagina a fumetti (JHT_PROMO=chat) che si scrive da sola: vignette, "sta scrivendo…", risposta · "And you talk to them, like teammates." |
| 10 | 0:44–0:48 | Il sito | Screenshot pubblico e anonimo del case study (mappa Europa) in una finestra browser · "Follow the hunt from the web, anywhere." |
| 11 | 0:48–0:52 | Risultati | KPI da dati pubblici e anonimi (beta tester, 3 giu → 3 lug 2026): 658 positions found · 520 analysed and scored · 307 strong matches ≥70 · 71/100 average match |
| 12 | 0:52–0:55 | Open source | Illustrazione "the box" · "Open source (MIT). Runs in a container on your machine: your data stays yours." |
| 13 | 0:55–0:59 | CTA | Wordmark · "free · open source · in beta" · jobhunterteam.ai · github.com/leopu00/job-hunter-team |

## Riprese vere del gioco (scene 7, 8, 9)

- Registrate da `record_clips.sh` con `godot --write-movie` (Godot 4.7,
  Movie Maker mode): sequenze PNG 1920×1080 a 30 fps in `scenes/capture/`.
  L'orizzontale le riscala a 1280×720; il verticale ritaglia una colonna
  608×1080 che insegue il soggetto e la riscala a 720×1280. Nessuna cattura
  schermo.
- **Camera vicina** (`game/tools/promo_director.gd`):
  - `office`: 2,6 s di totale → spinta di 3,6 s dentro il Research fino a
    zoom 1.95 sulle due scrivanie occupate (sedute ~(542,482)/(569,629),
    quasi in colonna: la stessa ripresa regge il ritaglio 9:16), poi lenta
    deriva a zoom 2.02. Vignette dei due Scout DOPO l'arrivo della camera,
    e tenute sotto il banner UI "SIMULATION — not real data" (al primo ciak
    lo copriva: rifatto).
  - `dept`: carrellata (620,1640)→(700,1655) a zoom 2.05→2.18 sulle due
    scrivanie occupate degli Scrittori; il centro y tiene la targa
    "APPLICATIONS" fuori dal quadro (mezza targa tagliata è peggio di
    nessuna) e libera la fascia bassa per le didascalie.
  - una vignetta per agente in campo: SpeechBubble tiene la prima per 60 s
    (MIN_HOLD), una seconda non apparirebbe mai nel ciak.
- Ufficio in **showroom** (`JHT_NOVPS=1`): nessun backend, nessun dato reale.
  Ogni testo in scena è INVENTATO e in inglese.
- UI del gioco in inglese (`JHT_LANG=en`); le scritte di scena non ancora
  localizzate (targhe reparto, insegne di passaggio) sono doppiate in inglese
  per la sola durata del ciak (`game/tools/promo_dept_signs.gd`). I nomi
  propri degli agenti (Il Coordinatore, Holmes…) sono il brand, identici in
  tutte e sette le lingue.
- Le didascalie del montaggio stanno su una **pastiglia scura** centrata: mai
  testo sopra testo del gioco. Nella scena chat orizzontale la pastiglia sta
  a y=560, sopra la targa "HOLMES · SCOUT-1" (y≈603) e sotto l'ultima
  vignetta. Verificato su fotogrammi estratti (`extract_check_frames.py`, ora
  su ENTRAMBI i formati) che nessuna didascalia copra etichette di reparto,
  vignette o targhe.

## Verticale (make_vertical.py)

- Scene di testo REIMPAGINATE per la colonna (titoli su due righe, corpi
  proporzionati), mai rimpicciolite dall'orizzontale.
- Riprese del gioco: ritaglio 608×1080 che insegue la colonna dei soggetti
  ricalcolando il percorso camera della regia fotogramma per fotogramma
  (`_office_cam`/`_dept_cam`, stessa easing sinusoidale della tween Godot).
- Chat: COMPOSITO — header, colonna vignette a tutta larghezza (il testo
  esce più grande che nell'orizzontale), ritratto con targa sotto, sfondo
  griglia brand.

## Asset statici (tutti già nel repo, nessun dato personale)

- `web/public/landing-hero.png`, `web/public/the-box.png` — illustrazioni brand
- `web/public/agents-{scouts,analyst,scorer}.png` — ritratti dei ruoli
- `assets/screenshots/beta2-map.png` — case study pubblico e anonimo (stesso screenshot del README)
- Font: JetBrains Mono (brand) da `~/Library/Fonts`

## Rigenerare

```bash
./record_clips.sh                       # riprese del gioco → scenes/capture/
python3 make_presentation.py            # → jht-presentation.mp4 (1280×720)
python3 make_vertical.py                # → jht-presentation-vertical.mp4 (720×1280)
python3 extract_check_frames.py         # → scenes/check/ fotogrammi di verifica (g_* e v_*)
```

`scenes/`, `scenes-vert/` e i `.mp4` sono ignorati da git (vedi `.gitignore`).
