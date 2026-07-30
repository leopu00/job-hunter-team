# Video di presentazione JHT — scaletta (~59 s · 1280×720 · senza audio · testi in INGLESE)

Generato da `make_presentation.py` (PIL + ffmpeg, impianto ripreso dal promo
v0.2.0). Tre scene sono **riprese vere del gioco** registrate con la Movie
Maker mode di Godot (`record_clips.sh` + `game/tools/promo_director.gd`):
rendering fotogramma per fotogramma, deterministico, niente cattura schermo.
Transizioni: xfade 0,5 s tra ogni scena.

| # | Tempo | Scena | Contenuto a schermo |
|---|-------|-------|---------------------|
| 1 | 0:00–0:04 | Hook | "Job hunting is a second job." + le tre incombenze quotidiane |
| 2 | 0:04–0:08 | Reveal | Wordmark "Job Hunter Team" · "a team of AI agents that hunts jobs for you" · `$ jht team start` con cursore |
| 3 | 0:08–0:12 | La squadra | Illustrazione della riunione (landing-hero) con Ken Burns · "A real team: clear roles, a Captain, a weekly budget to respect." |
| 4 | 0:12–0:14 | The Scouts | Ritratto + "They sweep the job boards. Day and night." · barra pipeline in basso |
| 5 | 0:14–0:17 | The Analysts | "They read every posting. They extract what matters." |
| 6 | 0:17–0:19 | The Scorers | "A score for every position: how well it fits you, 0-100." + badge animato 0→84/100 |
| 7 | 0:19–0:26 | **RIPRESA VERA — reparto Scrittori** | Carrellata sul reparto (JHT_PROMO=dept): agenti alla scrivania, vignette inglesi sui CV · didascalie Writers/Critics su pastiglia |
| 8 | 0:26–0:35 | **RIPRESA VERA — l'ufficio** (il punto emotivo) | Overview con lenta spinta della camera (JHT_PROMO=office), reparti che chiacchierano in inglese · "Not a dashboard: an office, inside a video game." → "Watch them work for you, while you do something else." |
| 9 | 0:35–0:44 | **RIPRESA VERA — la chat** | Pagina a fumetti (JHT_PROMO=chat) che si scrive da sola: vignette, "sta scrivendo…", risposta · "And you talk to them, like teammates." |
| 10 | 0:44–0:48 | Il sito | Screenshot pubblico e anonimo del case study (mappa Europa) in una finestra browser · "Follow the hunt from the web, anywhere." |
| 11 | 0:48–0:52 | Risultati | KPI da dati pubblici e anonimi (beta tester, 3 giu → 3 lug 2026): 658 positions found · 520 analysed and scored · 307 strong matches ≥70 · 71/100 average match |
| 12 | 0:52–0:55 | Open source | Illustrazione "the box" · "Open source (MIT). Runs in a container on your machine: your data stays yours." |
| 13 | 0:55–0:59 | CTA | Wordmark · "free · open source · in beta" · jobhunterteam.ai · github.com/leopu00/job-hunter-team |

## Riprese vere del gioco (scene 7, 8, 9)

- Registrate da `record_clips.sh` con `godot --write-movie` (Godot 4.7,
  Movie Maker mode): sequenze PNG 1920×1080 a 30 fps in `scenes/capture/`,
  riscalate a 1280×720 dal montaggio. Nessuna cattura schermo.
- Ufficio in **showroom** (`JHT_NOVPS=1`): nessun backend, nessun dato reale.
  Ogni testo in scena è INVENTATO e in inglese (`game/tools/promo_director.gd`).
- UI del gioco in inglese (`JHT_LANG=en`); le scritte di scena non ancora
  localizzate (targhe reparto, insegne di passaggio) sono doppiate in inglese
  per la sola durata del ciak (`game/tools/promo_dept_signs.gd`). I nomi
  propri degli agenti (Il Coordinatore, Holmes…) sono il brand, identici in
  tutte e sette le lingue.
- Le didascalie del montaggio stanno su una **pastiglia scura** centrata: mai
  testo sopra testo del gioco (la barra dei comandi camera in basso è spenta
  durante il ciak). Nella scena chat la pastiglia sta a y=560, sopra la targa
  "HOLMES · SCOUT-1" (y≈603) e sotto l'ultima vignetta: a y=600 ne copriva il
  bordo sinistro. Verificato su fotogrammi estratti (`extract_check_frames.py`)
  che nessuna didascalia copra etichette di reparto o vignette.

## Asset statici (tutti già nel repo, nessun dato personale)

- `web/public/landing-hero.png`, `web/public/the-box.png` — illustrazioni brand
- `web/public/agents-{scouts,analyst,scorer}.png` — ritratti dei ruoli
- `assets/screenshots/beta2-map.png` — case study pubblico e anonimo (stesso screenshot del README)
- Font: JetBrains Mono (brand) da `~/Library/Fonts`

## Rigenerare

```bash
./record_clips.sh                       # riprese del gioco → scenes/capture/
python3 make_presentation.py            # → jht-presentation.mp4 accanto allo script
python3 extract_check_frames.py         # → scenes/check/ fotogrammi di verifica
```

`scenes/` e i `.mp4` sono ignorati da git (vedi `.gitignore`).
