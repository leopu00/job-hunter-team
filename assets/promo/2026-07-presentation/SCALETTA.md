# Video di campagna «Now Playable» — produzione (03/08)

Esecuzione della regia approvata
`docs/internal/experiments/2026-08-03-regia-video-campagna.md`: il gioco in
pieno giorno al fotogramma 1, il puntatore che clicca dal secondo 7, l'88
come filo conduttore, copione §6 parola per parola. Questo file è il diario
di produzione: cosa è stato girato, con quali meccanismi, e dove la regia
non era producibile alla lettera.

## Timeline (8 scene, stacchi netti, una sola dissolvenza 7→8)

Durate calcolate dalle durate REALI della voce (audio/play/durations.txt):
lead + battuta + coda per scena. Totale ~75,5 s; parlato 65,4 s; gap fra
battute misurati 0,7–1,2 s (vincolo ≤ 1,5 s).

| # | Scena | Durata | Contenuto | Voce |
|---|-------|--------|-----------|------|
| 1 | open   | 5,6 | GIOCO giorno: lo Scout si alza, stampa, torna, si siede (3 finestre, cut on action) | V1 4,3s |
| 2 | click  | 9,5 | GIOCO: hover+clic sullo Scout → chat a fumetti che si scrive (chip → input → SEND → attesa → risposta); puntatore DISEGNATO sui frame noti | V2 8,4s |
| 3 | pixels | 9,4 | GIOCO: l'Analista preleva dalla vaschetta e studia (vignetta di verifica); primo piano macchina da scrivere | V3 8,4s |
| 4 | tailor | 11,7 | GIOCO: Scorer «88/100» → Scrittore «CV rewritten» → Critico → scaffale «pass» | V4 10,7s |
| 5 | globe  | 12,0 | WEB demo: mezzo giro del globo → clic sul beacon di Amsterdam (flyTo) → pannello POSITIONS → riga GreenGrid → scheda (anello 88, breakdown, CV ready · Critic: PASS) → clic su «Swipe» | V5 10,9s |
| 6 | swipe  | 8,3 | WEB demo: card GreenGrid 88 → stella (vola a destra) → entra la 58 → X → entra la terza | V6 7,3s |
| 7 | home   | 12,3 | Illustrazione the-box (Ken Burns 1,0→1,08) + GIOCO notte: una scrivania nella pozza della lampada | V7 11,1s |
| 8 | cta    | 7,3 | Card scura: JOB HUNTER TEAM · jobhunterteam.ai · Free · Open source · Beta (URL ≥ 3 s) | V8 4,5s |

## Voce — George confermato con audizione misurata

Il registro nuovo («brillante, complice, da trailer di gioco», §6) è stato
messo alla prova: George contro tre voci più «da trailer» sulla battuta V1.

| voce | c/s | f0 med | centroide | sd RMS |
|------|-----|--------|-----------|--------|
| **George** | 15,7 | **137 Hz** | 2320 Hz | **0,099** | ← tenuto
| Liam | 14,9 | 131 | 1883 | 0,093 |
| Charlie | 17,3 | 120 | 971 | 0,106 |
| Will | 17,1 | 117 | **2333** | 0,074 |

George sulla battuta-esca è il più vivo dove conta: dizione nitida quanto
Will ma con la consegna più espressiva e la f0 più alta — regge il sorriso
senza perdere l'autorevolezza che disinnesca il «sembra un giochino».
Charlie è energico ma impastato; Will chiaro ma piatto. Wav in
audio/candidates/. Copione §6 PAROLA PER PAROLA (8 battute, 966 caratteri,
una sola generazione): audio/play/segNN.wav.

## Gioco — clip nuovi (promo_director.gd, Movie Maker mode)

`JHT_PROMO=open-day|click-chat|work-pixels|tailor-88|dusk-night`
(record_clips.sh; giorno JHT_HOUR=10, notte JHT_HOUR=2). Meccanismi:

- i viaggi fisici sono le tappe VERE della pipeline (stampante+PrinterFx,
  pile_take/pile_drop, scaffale output) forzate con PAUSE FISSE
  (`_force_legs`) al passo vero della pipeline (185 px/s);
- camera a inseguimento morbido (lerp 0,08) o ferma sui primi piani; zoom
  sempre ≥ 1,9; le ri-inquadrature del montaggio sono CROP 1440x810 → 720p
  (zoom digitale dal master 1080p, mai sotto il pixel 1:1);
- vignette di regia via `publish_chat`, agganciate ai GESTI (la verifica
  parte quando l'Analista si è seduto davvero; il «pass» quando la
  cartellina tocca lo scaffale), non a cronometro;
- chat della Scena 2 via `publish_agent_chat` con chip `choices`, testo che
  scorre nell'input un carattere per frame, indicatore «waiting for the
  reply…» e risposta finale — il contratto vero del pannello;
- ciak «vestito»: insegne inglesi, targhe di stato spente, HUD «JHT TEAM»
  rimosso (numeri aggregati vietati §7.2), chiacchiericcio ambientale
  AZZERATO (le battute di contorno dello showroom sono in ITALIANO e con
  l'hold lungo scacciavano le vignette di regia — visto al primo ciak);
- l'offset camera dell'Analista è POSITIVO (aria sotto): la sua scrivania
  è contro il muro nord e la vignetta finiva dietro il banner SIMULATION.

## Web — riprese demo col cursore DOM (record_web.py)

Playwright Chromium headed su :3007 in demo mode (persona software, tema
dark, en, banner «DEMO MODE» sempre in quadro). Il puntatore è UN SOLO
meccanismo per tutte le scene web: cursore DOM iniettato che segue gli
eventi mouse veri — movimenti a passi con easing, pausa prima del click,
onda su mousedown; nelle riprese mobili diventa un cerchio di tocco.

- **web_hunt**: sfera → mezzo giro (drag 1:1) → Overview → clic sul beacon
  dei Paesi Bassi → flyTo su Amsterdam → pannello POSITIONS (hover con
  card «88») → clic sulla riga GreenGrid (apre la scheda: qui si stacca);
- **web_sheet**: scheda `demo-software-003` (anello 88, EUR 80.000–105.000,
  Full remote) → breakdown → «CV ready · Critic: PASS» → clic su «Swipe»
  nella nav. Le note demo sono servite in INGLESE dal layer demo (niente
  italiano in quadro);
- **web_swipe**: filtro categoria «DevOps / Cloud» + ordinamento «Newest
  first» PRIMA della finestra → il mazzo «to review» è [88 GreenGrid, 58,
  63, 92]: stella sulla 88 (vola a destra) → entra la 58 → X → entra la
  terza. NB: nel prodotto il drag è NAVIGAZIONE, non verdetto — la stella
  è l'alternativa prevista dalla regia («o clicca la stella»).

## Deviazioni dalla regia (motivate)

1. **«Download CV» (Scena 5)** — il bottone NON ESISTE in demo mode
   (`cv_pdf_path: null` in web/lib/demo/queries.ts) e in demo non si finge
   un download (§9). Chiusura della scena SUL clic vero di navigazione
   «Swipe», dopo il fermo su «CV ready · Critic: PASS».
2. **«Punteggio basso» della seconda card (Scena 6)** — nel mazzo demo
   «to review» DevOps la card dopo la 88 è la 58 (non esiste una
   two-digit sotto i 50 non ancora giudicata dopo la 88): la X cade sulla
   58, comunque sotto la soglia dei match forti.
3. **«Mezza figura» (Scena 1)** — a mezzo busto vero l'arte upscalerebbe
   oltre il pixel 1:1: si arriva a zoom efficace ~2,6 con ciak a 1,95 +
   crop 1440x810, il massimo senza degrado.
4. **Ritratto della chat** — il prodotto usa il ritratto di RUOLO per
   «Holmes · scout-1» (capelli bianchi) mentre l'arte da seduto del desk 1
   è mora: incoerenza del prodotto, non della produzione (segnalata).

## Rigenerare

```bash
./record_clips.sh                        # 5 clip gioco → scenes/capture/
python3 record_web.py                    # 6 riprese web → webrec/*.webm
python3 make_voiceover.py                # voce → audio/play/segNN.wav
python3 make_show.py                     # → jht-play.mp4 (1280x720)
python3 make_show_vert.py                # → jht-play-vertical.mp4 (720x1280)
python3 extract_final_frames.py h v      # fotogrammi di verifica
```

Le finestre di montaggio (frame e secondi, 1:1) stanno in `shots_play.py`.

## Consegna

- `jht-play.mp4` — 1280x720 · ~75,5 s · ben sotto i 45 MB
- `jht-play-vertical.mp4` — 720x1280 · ~75,5 s · ben sotto i 45 MB
- solo voce (niente musica: §7.14, nessuna licenza), inglese, nessun dato
  reale (gioco showroom + web demo mode, banner sempre in quadro)
- nessun fattore di velocità ≠ 1 in nessun punto del montaggio
