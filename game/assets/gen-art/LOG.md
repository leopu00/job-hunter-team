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
