# Video di presentazione JHT — copione RICCO, riprese 1:1 (~67 s · inglese · 2 formati)

Tornata del 03/08-bis sui due rilievi dell'utente alla versione da 54 s:

1. **"avete velocizzato il video … non va bene — il video deve essere fluido"**
   → REGOLA NUOVA, NON NEGOZIABILE: tutte le riprese girano a **velocità
   naturale, 1:1**. Il parametro `speed` di `web_segment`/`web_segment_vert`
   è stato **eliminato** (prima comprimeva il globo a 1,61x e positions/swipe
   a 1,52x/1,26x): ora si sceglie la **finestra** migliore della ripresa
   lunga quanto la scena, non si comprime il tempo. Le riprese del gioco
   erano già 1:1 (30 fps girati = 30 fps montati) e tali restano. Nei
   montaggi non sopravvive alcun `setpts` divisore né `atempo` (grep pulito;
   l'unico `setpts=PTS-STARTPTS` ribasa i timestamp dopo il trim, fattore 1).
2. **"il testo va migliorato … mi piaceva com'era prima più ricco"**
   → copione a **11 battute** (~750 caratteri, sotto: recuperati i ruoli con
   le mansioni, la chat con gli agenti e i numeri reali dal copione a 12
   della storia git). Le **durate delle scene si calcolano dalla voce**
   (lead + wav reale + coda): più testo = video più lungo (67 s, dentro i
   65-80 accettati), mai battute compresse o riprese accelerate.

## Copione (parola per parola — 11 battute, ~49 s di parlato)

| # | Scena | Voce |
|---|-------|------|
| 1 | hook | "Job hunting is a second job." |
| 2 | reveal | "So we built you a team. Job Hunter Team." |
| 3 | meeting | "A team of AI agents, with clear roles, a captain, and a weekly budget." |
| 4 | roles | "Scouts sweep the job boards. Analysts read every posting. And Scorers rate each match against your profile, from zero to one hundred." |
| 5 | dept | "Writers tailor your CV, position by position. Critics review every draft." |
| 6 | office | "It is not a dashboard. It is an office, inside a video game. You watch your team work, while you do something else." |
| 7 | chat | "And you talk to them like teammates. Ask, steer, approve." |
| 8 | globe | "From anywhere: every position they found, on your own globe." |
| 9 | webpages | — (muta: didascalie "every position · match score · salary" / "swipe to decide") |
| 10 | results | "In one real month, hands off, they found six hundred and fifty-eight positions." |
| 11 | box | "Open source. It runs on your machine, and your data stays yours." |
| 12 | cta | "Job Hunter Team. Free, and in beta." |

Ogni battuta vive per intero nella sua scena: niente più L/J-cut, niente
didascalie doppione della voce (tolte da meeting, dept, chat; restano sulle
scene mute). Le didascalie di ruolo nella scena 4 (staffetta) cambiano sulle
**cesure reali** della battuta (silencedetect su seg03: 1,78 s e 3,85 s →
`ROLE_SWITCH` in make_show.py; da rimisurare se si rigenera la voce).

## Voce — ElevenLabs George (scelta con audizione misurata)

- Motore: **ElevenLabs**, modello `eleven_multilingual_v2`, voce **George —
  Warm, Captivating Storyteller** (en-GB), dietro `ENGINE` in
  `make_voiceover.py` (il vecchio `say`/Daniel resta come fallback offline).
- Scelta fra 4 candidate maschili sulla stessa frase di prova (i wav sono in
  `audio/candidates/` per riascolto): metriche misurate sul segnale —
  | Voce | Passo | f0 mediana | IQR f0 | Note |
  |------|-------|-----------|--------|------|
  | **George** | 17,9 c/s | 124 Hz | 34 | **scelto**: dizione più nitida (centroide 3,7 kHz), baritono caldo, espressivo ma controllato; nasce per narrazione |
  | Roger | 17,4 c/s | 98 Hz | 35 | ottimo secondo: più scuro e "casual", meno stacco consonantico |
  | Brian | 21,2 c/s | 88 Hz | 17 | corre ed è monotono |
  | Bill | 14,5 c/s | 183 Hz | 74 | teatrale e lento, da spot |
- La chiave sta in `~/.config/jht/elevenlabs.env` e **non si stampa mai**;
  piano free ~10.000 crediti/mese, il copione ne usa ~750 a rigenerazione
  (questa tornata ne ha consumati ~1.750: 4 prove voce + una rigenerata per
  il fix del trim). `previous_text`/`next_text` passano il contesto fra i
  segmenti per una prosodia continua.
- **Trappola risolta**: il vecchio trim `silenceremove stop_periods=1`
  tagliava alla prima pausa INTERNA (George respira fra le frasi → battute
  mozzate). Ora il trim usa il giro `areverse` e tocca solo testa e coda.

## Timeline (12 scene, xfade 0,5 s — condivisa dai due formati, 67,4 s)

| # | Scena | Durata | Contenuto | Audio |
|---|-------|--------|-----------|-------|
| 1 | hook | 3,6 | "Job hunting is a second job." | voce 1 |
| 2 | reveal | 4,4 | wordmark + `$ jht team start` | voce 2 |
| 3 | meeting | 6,5 | illustrazione riunione (Ken Burns) | voce 3 |
| 4 | roles | 9,7 | staffetta Scouts→Analysts→Scorers + badge 84/100 | voce 4 (cambi sulle cesure) |
| 5 | dept | 6,6 | **GIOCO** reparto Applications (fine clip: 2 vignette) | voce 5 |
| 6 | office | 8,4 | **GIOCO** panoramica + push sul Research + 2ª vignetta | voce 6 |
| 7 | chat | 5,5 | **GIOCO** chat a fumetti (f115, chiude sull'ultima risposta) | voce 7 |
| 8 | globe | 5,6 | **WEB** `/map` 6,2→11,8 s 1:1: Europa → sfera → rotazione | voce 8 |
| 9 | webpages | 5,6 | **WEB** `/positions` 4,3→ e `/swipe` 5,2→ 1:1 (2,8 s l'una) | **muta** + didascalie |
| 10 | results | 6,2 | KPI del mese reale (658/520/307/71) | voce 9 |
| 11 | box | 5,8 | the-box: "Open source (MIT)" | voce 10 |
| 12 | cta | 5,0 | wordmark · jobhunterteam.ai · github | voce 11 |

Pause misurate fra le battute: 0,8-1,2 s; l'unico respiro lungo (6,4 s)
copre la scena webpages, che è tempo di lettura. La voce non scavalca mai
uno stacco (silencedetect sul file finale: ogni blocco chiude prima della
dissolvenza della sua scena). Verificato anche con trascrizione whisper:
tutte le 11 battute presenti e corrette.

## Verticale — fix del residuo segnalato (~24 s, lettere al bordo)

Era la scritta a pavimento del reparto RESEARCH ("They scout the web for
openings for you") che nel girato transita in basso durante il push della
camera di gioco: il vecchio sweep della colonna la incrociava a metà
transito e a fine sweep (fermo su x0=450) ne restava un frammento statico
("…s for you") mozzato al bordo sinistro. Ora (`office_x0`):

- **f40-150 fermo a x0=60**: panoramica; a 60 la pillola "→ QUALITY CHECK"
  entra intera nel quadro; la scritta RESEARCH piccola resta completa; il
  suo ingresso in campo (f135-150) avviene dal bordo in movimento = pan
  naturale, nessun frammento fermo;
- **f150-172 sweep 60→455** che insegue la scritta mentre scivola via in
  basso a destra: il testo esce di quadro IN MOVIMENTO; la chiusura a f172
  cade quando la scritta è già tutta a sinistra della finestra (verificato
  sui frame del file finale: dalla 32,5 s la colonna è pulita);
- **f172+ fermo a x0=455**: entrambe le vignette complete (la 2ª, "Two look
  promising…", occupa x605-1058 nei nativi) e tutti e due gli scout in campo.

Altri accorgimenti verticale:
- banda didascalia dept alzata a **min 118 px**: con lo skip anticipato
  (f74, scena più lunga) la scritta APPLICATIONS a pavimento partiva con le
  cime a y display ~1185; la banda ora la copre dal primo frame. Testo della
  banda: "the Applications department" (etichetta il luogo, non duplica la
  battuta sui Writers/Critics);
- la banda "SIMULATION — not real data" in alto resta: badge sempre completo;
- swipe mobile: finestra allineata alla FINE della clip così ogni carta
  appare una volta sola (prima del rewind la ML card tornava in scena).

## Riprese web private (record_web.py) — INVARIATE, riusate

- Playwright Chromium headed su :3007 in demo mode (persona software),
  login e2e, banner "DEMO MODE — sample data" in quadro, tema dark,
  `i18n-prefs.json` = en nella JHT_HOME vuota (titoli server-rendered).
- Nessun dato reale: dataset demo (`web/lib/demo/`).
- NB: l'intestazione di `/positions` a inizio clip è in italiano
  ("Posizioni") — la finestra 1:1 parte a 4,3 s, nella zona scrollata tutta
  in inglese.
- Desktop 1280x720 (orizzontale) e mobile 390x693 @2x (verticale).

## Rigenerare

Gli intermedi NON sono nel repo (gitignored): si rigenerano con le stesse
ricette, deterministiche.

```bash
./record_clips.sh                        # riprese gioco → scenes/capture/
python3 record_web.py                    # riprese web → webrec/*.webm
python3 make_voiceover.py                # voce → audio/sober/segNN.wav (~750 crediti EL)
# se la voce cambia: rimisurare le cesure della battuta 4 e aggiornare
# ROLE_SWITCH in make_show.py:
#   ffmpeg -i audio/sober/seg03.wav -af silencedetect=noise=-38dB:d=0.18 -f null -
python3 make_show.py                     # → jht-show-sober.mp4 (1280x720)
python3 make_show_vert.py                # → jht-show-vertical-sober.mp4
python3 remux_only.py                    # solo audio, senza rimontare
python3 extract_final_frames.py h v      # fotogrammi di verifica
```

## Consegna (03/08-bis)

- `jht-show-sober.mp4` — 1280x720 · 67,4 s · 18,0 MB
- `jht-show-vertical-sober.mp4` — 720x1280 · 67,5 s · 16,7 MB
- entrambi ben sotto i 45 MB · niente musica · inglese · nessun dato reale
- **nessun fattore di velocità ≠ 1 nel montaggio** (verificato su codice e
  a vista sui fotogrammi: movimento naturale ovunque)

## Asset statici (tutti già nel repo, nessun dato personale)

- `web/public/landing-hero.png`, `web/public/the-box.png`
- `web/public/agents-{scouts,analyst,scorer}.png`
- Font: JetBrains Mono (brand) da `~/Library/Fonts`
