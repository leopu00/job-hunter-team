# Video di presentazione JHT — versione DENSA (~54 s · inglese · 2 formati)

Tornata del 03/08 sul feedback utente alla versione da 73,5 s:

1. **più corto e più denso** — via i vuoti, NON accelerando il parlato;
2. **il verticale aveva sezioni male inquadrate** — riviste tutte le scene
   fotogramma per fotogramma e ritarate (elenco sotto);
3. **voce migliore** — l'utente valuta un motore a pagamento: la generazione
   è isolata in `make_voiceover.py` dietro `ENGINE` (una riga da cambiare);
   nel frattempo resta Daniel en_GB, la migliore voce di sistema installata.

## Copione (parola per parola — 7 battute, INVARIATO, ~27,5 s di parlato)

| # | Scena | Voce |
|---|-------|------|
| 1 | hook | "Job hunting is a second job." |
| 2 | reveal | "So we built you a team. Job Hunter Team." |
| 3 | roles | "Your agents find the positions, and score every match against your profile." |
| 4 | office→chat | "It is not a dashboard. It is an office, inside a video game. You watch your team work, while you do something else." |
| 5 | globe | "And from anywhere: every position they found, on your own globe." |
| 6 | results→box | "Open source. It runs on your machine, and your data stays yours." |
| 7 | cta | "Job Hunter Team. Free, and in beta." |

La battuta 4 non sta più in gabbia nella sua scena: prosegue sul taglio
verso la chat (**L-cut**). La 6 parte 1,4 s prima della scena box, sul
finale dei numeri (**J-cut**). Il testo e il rate (155) non cambiano: il
tempo guadagnato viene TUTTO dalle pause e dalle scene mute accorciate.

## Timeline (12 scene, xfade 0,5 s — condivisa dai due formati, ~53,8 s)

| # | Scena | Durata | Contenuto | Audio |
|---|-------|--------|-----------|-------|
| 1 | hook | 3,6 | "Job hunting is a second job." | voce 1 |
| 2 | reveal | 4,4 | wordmark + `$ jht team start` | voce 2 |
| 3 | meeting | 3,5 | illustrazione riunione (Ken Burns) | **muta** + didascalia |
| 4 | roles | 6,6 | staffetta Scouts→Analysts→Scorers + badge 84/100 | voce 3 |
| 5 | dept | 4,0 | **GIOCO** reparto Scrittori (skip f100: 2 vignette subito) | **muta** + didascalia |
| 6 | office | 6,5 | **GIOCO** panoramica + push sul Research | voce 4 (L-cut →) |
| 7 | chat | 4,6 | **GIOCO** chat a fumetti (skip f115) | coda voce 4 |
| 8 | globe | 6,5 | **WEB** `/map`: Europa → sfera → rientro sui pin | voce 5 |
| 9 | webpages | 4,6 | **WEB** `/positions` + `/swipe` (2,3 s l'una) | **muta** + didascalie |
| 10 | results | 4,4 | KPI del mese reale (658/520/307/71) | **muta** (→ J-cut voce 6) |
| 11 | box | 5,6 | the-box: "Open source (MIT)" | voce 6 |
| 12 | cta | 5,0 | wordmark · jobhunterteam.ai · github | voce 7 |

## Struttura delle pause (misurata sul file finale, silencedetect)

| Da → a | Pausa | Cosa c'è in mezzo |
|--------|-------|-------------------|
| hook → reveal | 1,1 s | — |
| reveal → roles | 4,2 s | scena meeting (3,5 s, didascalia) |
| roles → office | 5,1 s | scena dept (4,0 s, 2 vignette + didascalia) |
| office → globe | 2,7 s | la voce 4 copre metà chat (L-cut) |
| globe → box | 8,3 s | webpages + results (didascalie + 4 numeri) |
| box → cta | 2,6 s | — |

Prima: pause 2,4-16 s e cinque scene mute da 5,5-9 s. Ora: mute superstiti
3,5-4,6 s, la voce attacca 0,5 s dopo l'inizio scena, gap minimo 0,9 s.
L'unico respiro lungo (8,3 s) copre le DUE scene di lettura (didascalie e
numeri grandi): è tempo di lettura, non attesa.

## Verticale — inquadrature riviste (segnalazione utente)

Controllato TUTTO il 720x1280 a 1 fps; difetti trovati e corretti in
`make_show_vert.py`:

1. **meeting**: il pan cx 0.50→0.55 spingeva il Capitano fuori: a fine
   scena restava il braccio. Ora colonna ancorata a lui (cx 560→575,
   zoom 1.0→1.05): lui, la mano sulla lavagna e il tavolo sempre interi.
2. **roles/Scouts**: il PNG sorgente è tagliato a x=0; scalato sull'altezza
   e centrato mostrava la scrivania MOZZATA a mezz'aria (e Analysts/Scorers
   sbordavano di 13-18 px). Ora Scouts a filo del bordo sinistro (il taglio
   del disegno coincide col bordo del quadro) e gli altri adattati a 720px.
3. **office**: la finestra che replicava la camera del gioco lasciava la
   targa RESEARCH mozzata a metà parola per ~2 s, il bottone menu ≡ tagliato
   e la vignetta "Boards swept…" che entrava di taglio. Ora x0 è un percorso
   diretto misurato sui frame nativi: panoramica a x0=0 (targa e bottone
   interi), sweep rapido che chiude PRIMA che la vignetta compaia, chiusura
   a x0=450 con vignetta completa e tutti e due gli scout in campo.
4. **dept**: finestra rimisurata (x0 265→242): due vignette complete e
   Scrittore intero; la scritta APPLICATIONS sul pavimento, prima mozzata
   ai lati della pillola, ora è coperta da una **banda didascalia piena**
   al piede (stesso pattern della banda SIMULATION in testa).
5. La banda "SIMULATION — not real data" in alto resta: badge sempre
   COMPLETO anche in colonna (soluzione già confermata dall'utente).

Chat (composito header+vignette+ritratto), globe/swipe mobili, results,
box e cta erano già composti per la colonna: verificati, nessun taglio.

## Voce — motore sostituibile in un punto solo

- `make_voiceover.py`: copione = lista `LINES` (un elemento per scena),
  motore = funzione dietro `ENGINE` (oggi `engine_say`, Daniel en_GB 155).
  Con il motore a pagamento: aggiungere `engine_<nome>()` e cambiare la
  riga `ENGINE = …`, poi rilanciare voiceover + i due montaggi.
- I montaggi rileggono le durate REALI da `audio/sober/durations.txt`
  (`vo_durs`/`vo_schedule`): un audio diverso riflow-a pause e attacchi da
  solo; il profilo delle pause viene stampato a ogni build per controllo.
- `say -v '?'` (03/08): nessuna voce Premium/Enhanced installata — Daniel
  resta la migliore di sistema.

## Riprese web private (record_web.py) — INVARIATE, riusate

- Playwright Chromium headed su :3007 in demo mode (persona software),
  login e2e, banner "DEMO MODE — sample data" in quadro, tema dark,
  `i18n-prefs.json` = en nella JHT_HOME vuota (titoli server-rendered).
- Nessun dato reale: dataset demo (`web/lib/demo/`).
- Desktop 1280x720 (orizzontale) e mobile 390x693 @2x (verticale).

## Rigenerare

Gli intermedi NON sono nel repo (gitignored): si rigenerano con le stesse
ricette, deterministiche.

```bash
./record_clips.sh                        # riprese gioco → scenes/capture/
python3 record_web.py                    # riprese web → webrec/*.webm
python3 make_voiceover.py                # voce → audio/sober/segNN.wav
python3 make_show.py                     # → jht-show-sober.mp4 (1280x720)
python3 make_show_vert.py                # → jht-show-vertical-sober.mp4
python3 remux_only.py                    # solo audio, senza rimontare
python3 extract_final_frames.py h v      # fotogrammi di verifica
```

## Consegna (03/08)

- `jht-show-sober.mp4` — 1280x720 · 53,8 s · 13,6 MB
- `jht-show-vertical-sober.mp4` — 720x1280 · 53,8 s · 13,5 MB
- entrambi ben sotto i 45 MB · niente musica · inglese · nessun dato reale

## Asset statici (tutti già nel repo, nessun dato personale)

- `web/public/landing-hero.png`, `web/public/the-box.png`
- `web/public/agents-{scouts,analyst,scorer}.png`
- Font: JetBrains Mono (brand) da `~/Library/Fonts`
