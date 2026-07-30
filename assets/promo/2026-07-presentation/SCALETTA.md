# Video di presentazione JHT — con VOCE e MUSICA (~61 s · 3 versioni · inglese)

Evoluzione del montaggio muto (v. storia git) sul feedback utente del 30/07:

1. **pagine web PRIVATE al posto del case study pubblico** — soprattutto il
   globo di `/map`, più `/positions` e `/swipe`, registrate in **demo mode**
   (dati inventati per costruzione, banner "DEMO MODE · sample data" sempre
   in quadro);
2. **meno testo, più intrattenimento** — le didascalie sono sparite quasi
   tutte: parla la voce narrante; a schermo restano titoli, nomi, numeri e
   indirizzi;
3. **voce narrante** — `say` di macOS (niente voci Premium installate:
   pulito ma riconoscibilmente sintetico);
4. **musica di sottofondo** — basi PROCEDURALI sintetizzate in numpy
   (nessun campione, nessun download: zero problemi di diritti).

## Le tre versioni (stesso montaggio video, audio diversi)

| Versione | Voce | Musica | Carattere |
|----------|------|--------|-----------|
| `warm`   | Samantha (en_US) | bossa lounge ~112 BPM | calda, racconta |
| `sober`  | Daniel (en_GB)   | **nessuna**           | asciutta, precisa |
| `upbeat` | Karen (en_AU)    | electro-bossa ~120 BPM con cassa | giocosa, ritmo su |

Output (tutti ~61 s, ~17 MB):

- `jht-show-{warm,sober,upbeat}.mp4` — orizzontale 1280x720
- `jht-show-vertical-{warm,sober,upbeat}.mp4` — verticale 720x1280

## Timeline (12 scene, xfade 0,5 s — condivisa dai due formati)

| # | Scena | Durata | Contenuto | Voce (sintesi) |
|---|-------|--------|-----------|----------------|
| 1 | hook | 3,8 | "Job hunting is a second job." | il problema |
| 2 | reveal | 3,3 | wordmark + `$ jht team start` | il reveal |
| 3 | meeting | 5,0 | illustrazione riunione (Ken Burns) | ruoli, capitano, budget |
| 4 | roles | 6,9 | staffetta Scouts→Analysts→Scorers + badge 84/100 | cosa fanno |
| 5 | dept | 6,0 | **RIPRESA GIOCO** reparto Scrittori | writers & critics |
| 6 | office | 8,4 | **RIPRESA GIOCO** l'ufficio (spinta sul Research) | "not a dashboard" |
| 7 | chat | 6,8 | **RIPRESA GIOCO** chat a fumetti | "like teammates" |
| 8 | globe | 8,2 | **WEB PRIVATO** `/map`: Europa → sfera → rientro sui pin | il globo |
| 9 | webpages | 4,4 | **WEB PRIVATO** `/positions` + `/swipe` (stacco secco) | scores, swipe |
| 10 | results | 4,8 | KPI del mese reale (658/520/307/71) | i numeri |
| 11 | box | 4,5 | the-box: "Open source (MIT)" | dati tuoi |
| 12 | cta | 4,4 | wordmark · jobhunterteam.ai · github | congedo |

La voce è ancorata all'inizio scena (+0,4 s) ma schedulata in sequenza con
gap minimo 0,3 s (`vo_schedule`): i segmenti lunghi non si accavallano mai.

## Riprese web private (record_web.py)

- Playwright **Chromium headed** (GPU vera: il globo WebGL in headless
  cade su SwiftShader) contro il dev server del worktree su :3007 con la
  ricetta canonica (`NEXT_PUBLIC_JHT_DEPLOY=cloud`, `JHT_HOME` vuota) +
  `JHT_WEB_DEMO_PERSONA=software`.
- Login con l'**account di test e2e** (`node e2e/scripts/refresh-auth-state.mjs`
  → storage state; credenziali MAI stampate). Il gate del layout passa per
  sessione vera; i dati veri dell'account non compaiono comunque: il ramo
  demo in `web/lib/queries.ts` precede ogni query.
- **Nessun dato reale in video**: aziende e posizioni sono il dataset demo
  (`web/lib/demo/`), il banner "DEMO MODE — sample data" resta in quadro.
- Tema dark forzato (`jht-theme`), qualità globo `high` (`jht-map-quality`),
  overlay dev di Next nascosto via CSS.
- Coreografia globo: vista Europa → 4 tacche di zoom-out fino alla sfera →
  rotazione (drag) andata-ritorno → click sul bottone "Overview — show all
  pins" (flyTo certo sui pin, niente zoom alla cieca). Dopo il click,
  `window.scrollTo(0,0)`: l'auto-scroll di Playwright spostava la pagina
  di ~20 px.
- Desktop 1280x720 (scene orizzontali) e mobile 390x693 @2x (verticale).

## Musica (make_music.py) — scelta e onestà

Sul Mac non ci sono campioni royalty-free né synth: le basi sono
**sintetizzate da zero** (numpy): giro I–vi–ii–V (Cmaj9 Am9 Dm9 G13),
basso bossa tonica-quinta, comping "Rhodes" sincopato, shaker, rim-click;
la variante electro aggiunge cassa 4/4 e pluck in sedicesimi. Mixate a
~9 dB sotto la voce. Risultato: musichetta da ascensore VOLUTA — semplice
e riconoscibilmente sintetica ma pulita; la versione `sober` esiste apposta
per chi la preferisce senza. Per una musica "vera" servirebbe una traccia
con licenza fornita dall'utente.

## Verticale (make_show_vert.py)

- Ritaglio 608x1080 che SEGUE il soggetto nelle riprese del gioco (replica
  del percorso camera di `promo_director.gd`), chat come composito.
- **Fix badge mozzato**: il ritaglio 9:16 tagliava il badge di gioco
  («SIMULATION — not real (»). Ora una banda opaca in alto porta il badge
  COMPLETO "SIMULATION — not real data" disegnato ex novo e copre il
  residuo tagliato. Verificato sui fotogrammi estratti.
- Web: riprese MOBILI vere (globo e swipe come li vede un telefono, banner
  demo per intero).

## Rigenerare

```bash
# riprese web (server dev :3007 in demo mode + auth e2e, vedi sopra)
python3 record_web.py                    # → webrec/*.webm
# audio
python3 make_voiceover.py                # → audio/{warm,sober,upbeat}/segNN.wav
python3 make_music.py                    # → audio/music_{bossa,electro}.wav
# montaggi (il video si monta una volta, poi si muxano le 3 tracce)
python3 make_show.py                     # → jht-show-{warm,sober,upbeat}.mp4
python3 make_show_vert.py                # → jht-show-vertical-*.mp4
python3 remux_only.py [versioni]         # solo audio, senza rimontare
python3 extract_final_frames.py h v      # fotogrammi di verifica
```

I sorgenti intermedi (`scenes/`, `webrec/`, `audio/`, `build*/`) e gli
`.mp4` sono gitignored. Le riprese del gioco in `scenes/capture/` sono
quelle APPROVATE (Movie Maker Godot, showroom `JHT_NOVPS=1`, tutto
inventato e in inglese): riusate, non rigirate.

## Asset statici (tutti già nel repo, nessun dato personale)

- `web/public/landing-hero.png`, `web/public/the-box.png`
- `web/public/agents-{scouts,analyst,scorer}.png`
- Font: JetBrains Mono (brand) da `~/Library/Fonts`
