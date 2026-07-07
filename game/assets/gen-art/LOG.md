# 🎨 gen-art — log dell'Art Director (mac-leone:dev1-art)

Asset generati via Codex CLI (tmux `codex-dev1`), giudicati contro:
- `web/public/agents-*.png` + `the-box.png` (identità personaggi, tratto)
- `game/docs/ANALISI-GIOCHI.md` §6 — ricetta Disco Elysium: pittorico,
  pennellate visibili, valore prima del colore, pozze di luce calda su
  ambiente freddo, bordi materici, niente pixel art / niente 3D render.
- `game/docs/refs/disco-elysium/*.jpg`

Regola: nessun file esistente viene toccato; solo file nuovi qui dentro.
Il master (`mac-leone:dev1-game-master`) integra.

## Sessioni

### 2026-07-07 — Esercitazione catena art→codex→verifica→consegna

| asset | file | iter | esito |
|---|---|---|---|
| Mentor 3 pose | portraits/mentor-frames.png (md5 658a2a6b) | 2 | ✅ approvato — v1 aveva un bastone duplicato in ogni frame e barba troppo corta; v2 corretta (versioni v1/v2 conservate) |
| Pavimento pittorico | floor/floor_main.png (+copia environment/) (md5 1d2df362) | 1 | ✅ approvato — spec ordine #1 del master rispettata (2048x1110, lavanda scuro, no baked light); tiling 2x2 verificato senza giunzioni dure; upscale 1703→2048 Lanczos |

### 2026-07-07 — Ordine #2: mobili batch 1 (11 pezzi, top-down 3/4, alpha, DE)

| # | file | iter | esito |
|---|---|---|---|
| 1 | furniture/desk.png 500x360 | 1 | ✅ integrato dal master |
| 2 | furniture/desk_wide.png 640x400 | 1 | ✅ integrato |
| 3 | furniture/sofa.png + sofa_bright.png 600x340 | 1+pp | ✅ master ha scelto sofa_bright (navy più vicino a #333f5c) |
| 4 | furniture/armchair.png 260x260 | 1 | ✅ integrato |
| 5 | furniture/coffee_table.png 360x220 | 1 | ✅ consegnato |
| 6 | furniture/bookshelf.png 560x260 | 1 | ✅ consegnato |
| 7 | furniture/coffee_bar.png 400x260 | 2+pp | ✅ Codex non accendeva la spia in 2 iter → glow #f5c518 dipinto in post (PIL screen mascherato su alpha). Lezione: piccoli accenti luminosi conviene farli in post, non re-promptare |
| 8 | furniture/lab_bench.png 660x320 | 1 | ✅ vetreria mint, microscopio |
| 9 | furniture/blackboard.png 160x520 | 1+reframe | ✅ contenuto 160x366 ancorato bottom (ok per il renderer del master) |
| 10 | furniture/plant.png 220x260 | 1 | ✅ monstera olive desaturata |
| 11 | furniture/floor_lamp.png 160x320 | 1+pp | ✅ paralume acceso #ffb45c dipinto in post (tinta multiply + glow screen su alpha) |

**Batch 11/11 completo** — 9 pezzi al primo colpo; luci accese = sempre post-process.

### 2026-07-07 — Ordine #4: ritratti dialogo 5 agenti (slug ITALIANI del runner)

| set | file | esito |
|---|---|---|
| assistente 4/4 | portraits/assistente/full_{neutro,caldo,sorpreso,divertito}.png | ✅ consegnato — gpt-5.5 high post-reset: pelle e alpha nativi ok; unico pp = dehalo bordo (regioni bianche del matte attorno ai capelli, visibili solo su dark bg) |
| coordinatore 3/3 | portraits/coordinatore/full_{neutro,caldo,severo}.png | ✅ tutti in 1 iterazione; dehalo su caldo+severo |
| scout 3/3 | portraits/scout/full_{neutro,caldo,pensieroso}.png | ✅ tutti in 1 iterazione; dehalo su caldo+pensieroso |
| scorer 3/3 | portraits/scorer/full_{neutro,pensieroso,caldo}.png | ✅ ref di profilo → fronte; 2 stream-drop recuperati (Esc + prompt in coda) |
| analista 3/3 | portraits/analista/full_{neutro,pensieroso,caldo}.png | ✅ donna (confermata dal master); dehalo SOLO capelli — col camice bianco l'euristica quasi-bianco mangia il camice (prima passata annullata, rifatta dalle v1) |

**ORDINE #4 COMPLETO 16/16** — tutti i ritratti in 1 iterazione di generazione.
Lezioni pipeline: (1) dehalo va ristretta spazialmente se il personaggio ha
capi bianchi; (2) su stream-drop di Codex: se rientra da solo aspettare
(Reconnecting n/5), se il turno muore re-promptare, se il file è già salvato
e Codex continua a verificare → Esc libera il prompt in coda.

Eventi Codex della sessione: limite 5h → auto-downgrade a gpt-5.4-mini
(matte rotto: 81% camicia alpha<100, speckle RGB, bocciato) → usato 1 usage
reset (ne resta 1, riservato ai casi blocking per direttiva master) →
/model gpt-5.5 high + /new (contesto era al 18%).
Check nuovi in pipeline: (1) alpha medio figura; (2) alone bianco su
composito scuro → dehalo selettivo (banda bordo + quasi-bianco desaturato).

### 2026-07-08 — Priorità autonome post-ordini (master offline)

| asset | file | iter | esito |
|---|---|---|---|
| Muro | environment/wall_main.png 2048x512 (md5 nel msg chat) | 1+pp | ✅ intonaco lavanda + battiscopa; giunzione orizzontale sistemata con wrap-blend (blur mascherato sulla vecchia giunzione dopo roll di w/2) |
| Vetro box | environment/glass_box.png 1024x1024 | 1 | ✅ overlay alpha media 9.6% (spec 8-14), striature ≤20%, stretchabile |
| Ologramma | furniture/hologram.png 520x640 | 1+pp | ✅ globo reso semi-trasparente in post (alpha ~194, piedistallo 253) |
| Title screen | environment/title_screen.png 1792x1024 | 1+pp | ✅ key art senza testo; warm boost +12% sulle pozze di lampada |

**Coda brief COMPLETA**: (a) ritratti tutti gli agenti ✅ (b) floor/muro/vetro ✅
(c) 11 mobili + ologramma ✅ (d) title screen ✅. In ascolto per nuovi ordini.

### 2026-07-07 — Ordine #3: ritratti Mentor 6 emozioni (1120x1520, mezzo busto, alpha)

| emozione | file | iter | esito |
|---|---|---|---|
| neutro (àncora) | portraits/mentor/full_neutro.png | 3+pp | ✅ Il generatore tinge la pelle di olive (contaminazione tunica), NON corregge nemmeno con hex espliciti → remap canali in post (olive→tan #c8a17a) mascherato hue+poligono spaziale. Script riusabile: scratchpad/fix_mentor_skin.py |
| caldo | portraits/mentor/full_caldo.png | 1+pp | ✅ |
| pensieroso | portraits/mentor/full_pensieroso.png | 1+pp | ✅ |
| sorpreso | portraits/mentor/full_sorpreso.png | 1+pp | ✅ |
| severo | portraits/mentor/full_severo.png | 1+pp | ✅ barba normalizzata (r-g 27.5→16.2) |
| divertito | portraits/mentor/full_divertito.png | 1+pp | ✅ barba normalizzata |

**Serie 6/6 completa** — contact sheet: portraits/mentor/_contact_sheet.png.
⚠️ BUG ALPHA scoperto a fine serie: il matte chroma-key di Codex lasciava
alpha ~40% sull'intera figura e bucava i dettagli inchiostrati scuri (alpha
correlato al colore, non alla copertura). Su dark bg = fantasmi. Fix:
ricostruzione alpha dalla silhouette (flood-fill dell'esterno con
ImageDraw.floodfill — attenzione: serve `.copy()` dopo fromarray o non
scrive — interno a 255 con erosione 2px, bordo = alpha originale x3).
Tutti i 6 finali rigenerati da v1 con pipeline deterministica.
**Check da fare SEMPRE sui PNG alpha di Codex: media alpha nella zona
sicuramente opaca, non solo % di pixel trasparenti.**

Lezione: quando il modello ha un bias di palette persistente (3 iter uguali),
smettere di re-promptare e correggere in post con maschere — il framing fisso
dei ritratti rende le maschere spaziali riusabili tra le varianti.

## Note su come promptare Codex

1. **Fargli aprire i riferimenti PRIMA di generare**: iniziare il prompt con
   "FIRST open and study these reference images: <path>" — Codex li visualizza
   davvero (`Viewed Image`) e l'aderenza a identità/palette ne beneficia molto.
2. **Descrivere il personaggio per esteso nel prompt** anche se c'è il
   riferimento (capelli, occhiali, tunica, oggetti): ancora meglio la coerenza.
3. **Path di output esplicito nel prompt** (`Save to game/assets/gen-art/...`):
   Codex salva da solo nel posto giusto, niente file da andare a cercare.
4. **Artefatti tipici da controllare**: oggetti duplicati (v1 Mentor: secondo
   bastone spurio in tutti i frame). Il re-prompt correttivo funziona se è
   chirurgico: dire cosa tenere identico ("everything else stays as in v1")
   e correggere UNA cosa per volta, per frame.
5. **tmux**: `send-keys -l '<prompt>'` incolla come bracketed paste → serve un
   secondo `send-keys Enter` separato per inviare davvero.
6. Tempi: ~2–3 min a generazione con gpt-5.5 high. Conviene un waiter in
   background sul file di output invece di poll manuale.
7. Il Godot editor aperto genera `.import` accanto ai PNG in assets/ — normale,
   non toccarli.
8. **Solo ASCII nei prompt via tmux send-keys**: un carattere multibyte ha
   spezzato il paste a metà (Codex ha ricevuto "120x1520" da "1120x1520").
   Se Codex fa una domanda di chiarimento, rispondere nel pane — non re-inviare
   tutto il prompt.
9. Se Codex sfora ~15 min su un task già risolto altrove: Esc interrompe e
   invia subito l'eventuale messaggio in coda.
10. Occhio al modello nella status bar del pane: vicino al limite 5h Codex
    auto-downgrada (gpt-5.5 high → gpt-5.4-mini). Giudicare il primo output
    del mini prima di continuare la serie.
