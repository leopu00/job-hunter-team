# Video di presentazione JHT — versione FINALE (~73 s · inglese · 2 formati)

Chiusura della tornata a 3 versioni audio (v. storia git) sul verdetto
dell'utente (30/07): ha scelto la **sober** — voce Daniel (en_GB), **senza
musica** — e ha chiesto:

1. **la voce dice meno** — il copione scende da 12 a **7 battute**; per ogni
   frase superstite vale il test "se la togli, si capisce lo stesso cos'è il
   prodotto?";
2. **più lento** — ~73 s invece di 61: scene più lunghe, la voce parte 0,6 s
   dopo l'inizio scena, gap minimo 0,6 s fra le frasi, **cinque scene mute**.
   Il silenzio è parte del montaggio;
3. **lo schermo mostra di più** — le informazioni tolte dal parlato diventano
   didascalie e numeri a video (leggere costa meno che ascoltare un elenco);
4. **due formati**: orizzontale 1280x720 e verticale 720x1280 per telefono.

## Copione (parola per parola — 7 battute, ~27,5 s di parlato)

| # | Scena | Voce |
|---|-------|------|
| 1 | hook | "Job hunting is a second job." |
| 2 | reveal | "So we built you a team. Job Hunter Team." |
| 3 | roles | "Your agents find the positions, and score every match against your profile." |
| 4 | office | "It is not a dashboard. It is an office, inside a video game. You watch your team work, while you do something else." |
| 5 | globe | "And from anywhere: every position they found, on your own globe." |
| 6 | box | "Open source. It runs on your machine, and your data stays yours." |
| 7 | cta | "Job Hunter Team. Free, and in beta." |

## Cosa è passato dalla voce allo schermo

| Battuta tolta (era voce) | Ora a schermo |
|--------------------------|---------------|
| "clear roles, a captain, a weekly budget" | didascalia sulla scena meeting |
| enumerazione Scouts/Analysts/Scorers | mansioni sotto i ritratti: "sweep the job boards" · "read every posting" · "rate the fit — 0 to 100" |
| "Writers tailor your CV… Critics review every draft" | didascalia sulla scena reparto |
| "You talk to them like teammates. Ask, steer, approve." | didascalia sulla scena chat |
| "Scores, salaries, quick reviews." | didascalie su /positions ("every position · match score · salary") e /swipe ("swipe to decide") |
| "In one real month it found 658 positions." | i numeri grandi della scena results (658 · 520 · 307 · 71/100) |

## Timeline (12 scene, xfade 0,5 s — condivisa dai due formati)

| # | Scena | Durata | Contenuto | Audio |
|---|-------|--------|-----------|-------|
| 1 | hook | 4,6 | "Job hunting is a second job." | voce 1 |
| 2 | reveal | 4,8 | wordmark + `$ jht team start` | voce 2 |
| 3 | meeting | 5,5 | illustrazione riunione (Ken Burns) | **muta** + didascalia |
| 4 | roles | 9,0 | staffetta Scouts→Analysts→Scorers + mansioni + badge 84/100 | voce 3 |
| 5 | dept | 6,5 | **RIPRESA GIOCO** reparto Scrittori | **muta** + didascalia |
| 6 | office | 9,5 | **RIPRESA GIOCO** l'ufficio (spinta sul Research) | voce 4 |
| 7 | chat | 6,5 | **RIPRESA GIOCO** chat a fumetti | **muta** + didascalia |
| 8 | globe | 9,0 | **WEB PRIVATO** `/map`: Europa → sfera → rientro sui pin | voce 5 |
| 9 | webpages | 6,5 | **WEB PRIVATO** `/positions` + `/swipe` (stacco secco) | **muta** + didascalie |
| 10 | results | 6,0 | KPI del mese reale (658/520/307/71) | **muta** |
| 11 | box | 6,0 | the-box: "Open source (MIT)" | voce 6 |
| 12 | cta | 5,0 | wordmark · jobhunterteam.ai · github | voce 7 |

La voce è ancorata all'inizio scena (+0,6 s) e schedulata in sequenza con gap
minimo 0,6 s (`vo_schedule`): mai sovrapposta, mai di corsa. Il rate di `say`
su Daniel è quasi ininfluente (voce Siri-era): la lentezza vera viene dal
copione corto e dalle pause, non dal parametro.

## Riprese web private (record_web.py)

- Playwright **Chromium headed** (GPU vera: il globo WebGL in headless cade
  su SwiftShader) contro il dev server su :3007 con la ricetta canonica
  (`NEXT_PUBLIC_JHT_DEPLOY=cloud`, `JHT_HOME` vuota) +
  `JHT_WEB_DEMO_PERSONA=software`.
- Login con l'**account di test e2e** (`node e2e/scripts/refresh-auth-state.mjs`
  → storage state; credenziali MAI stampate). Il gate del layout passa per
  sessione vera; i dati veri dell'account non compaiono comunque: il ramo
  demo in `web/lib/queries.ts` precede ogni query.
- **Nessun dato reale in video**: aziende e posizioni sono il dataset demo
  (`web/lib/demo/`), il banner "DEMO MODE — sample data" resta in quadro.
- Tema dark forzato (`jht-theme`), qualità globo `high` (`jht-map-quality`),
  overlay dev di Next nascosto via CSS.
- ⚠️ nella `JHT_HOME` "vuota" serve `i18n-prefs.json` = `{"locale":"en"}`:
  i titoli renderizzati dal SERVER (es. "Score Distribution" su `/map`)
  leggono quel file, non il cookie `NEXT_LOCALE` — senza, escono in italiano
  (successo alla prima tornata: "DISTRIBUZIONE SCORE" in quadro).
- Coreografia globo: vista Europa → 4 tacche di zoom-out fino alla sfera →
  rotazione (drag) andata-ritorno → click su "Overview — show all pins"
  (flyTo certo sui pin), poi `window.scrollTo(0,0)` contro l'auto-scroll.
- Desktop 1280x720 (scene orizzontali) e mobile 390x693 @2x (verticale).

## Verticale (make_show_vert.py)

- Ritaglio 608x1080 che SEGUE il soggetto nelle riprese del gioco (replica
  del percorso camera di `promo_director.gd`), chat come composito.
- **Badge sempre intero**: banda opaca in alto con "SIMULATION — not real
  data" COMPLETO, che copre il badge di gioco mozzato dal ritaglio 9:16
  (soluzione confermata dall'utente, mantenuta).
- Web: riprese MOBILI vere (globo e swipe come li vede un telefono, banner
  demo per intero).
- Didascalie ricomposte per la colonna (due righe dove serve).

## Riprese del gioco — note della seconda tornata

- **Camera reparto Scrittori RITARATA** (`game/tools/promo_director.gd`):
  il reparto è ora a "quadrante d'orologio" (sei scrivanie radiali) e le
  vecchie costanti — (620,1640) zoom 2,05→2,18 — inquadravano il tappeto
  vuoto. Ricalibrate su una sonda statica: (700,1650)→(715,1660), zoom
  1,80→1,92 — tutte e sei le scrivanie in campo, come nel girato approvato.
  Le stesse costanti sono replicate in `make_show_vert.py` (ritaglio 9:16).
- **Targhe "AL LAVORO" spente anche nel ciak chat**: sono solo in italiano
  e restavano leggibili dietro la pagina semi-trasparente.

## Rigenerare

Gli intermedi NON sono nel repo (gitignored) e le worktree precedenti sono
state ripulite: si rigenera tutto con le stesse ricette, deterministiche.

```bash
# riprese del gioco (Godot Movie Maker, showroom JHT_NOVPS=1, inglese,
# tutto inventato — la regia è game/tools/promo_director.gd)
./record_clips.sh                        # → scenes/capture/{office,dept,chat}/
# riprese web (server dev :3007 in demo mode + auth e2e, vedi sopra)
python3 record_web.py                    # → webrec/*.webm
# voce
python3 make_voiceover.py                # → audio/sober/segNN.wav
# montaggi (il video si monta una volta, poi si muxa la voce)
python3 make_show.py                     # → jht-show-sober.mp4
python3 make_show_vert.py                # → jht-show-vertical-sober.mp4
python3 remux_only.py                    # solo audio, senza rimontare
python3 extract_final_frames.py h v      # fotogrammi di verifica
```

## Asset statici (tutti già nel repo, nessun dato personale)

- `web/public/landing-hero.png`, `web/public/the-box.png`
- `web/public/agents-{scouts,analyst,scorer}.png`
- Font: JetBrains Mono (brand) da `~/Library/Fonts`
