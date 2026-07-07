# JHT: The Office — GDD sintetico (prototipo / vertical slice)

Un videogioco 2D top-down (2.5D via Y-sort) che gamifica Job Hunter Team: l'utente
cammina dentro "la box" — l'ufficio di vetro del sito (`web/public/the-box.png`) —
dove i suoi agenti AI lavorano, e ci parla da vicino. Non è un arcade: è
l'esperienza JHT vissuta in prima persona. Tutti i dati sono mock (vedi
`DATA-ADAPTER.md`).

- Engine: Godot 4.x, GDScript. Risoluzione 1920×1080, stretch `canvas_items`,
  fullscreen all'avvio (Esc → menu pausa).
- Stile: NON pixel art. Illustrazione flat/pulita fedele ai PNG `agents-*.png`
  (occhiali tondi scuri = firma degli agenti; il giocatore NON li porta: è
  l'unico umano nella box). Palette dal brand (`web/app/globals.css`): dark
  lavanda `#060608→#16161d`, bordi `#252530`, testo `#b8b8d0→#f0f0fa`, verde
  `#00e87a` + mint `#7fffb2`, accenti giallo/blu/rosso/viola. Font JetBrains
  Mono ovunque. UI = terminale/HUD: bordi squadrati, brackets a L verdi,
  griglia di sfondo sottile.

## Macchina a stati

```
BOOT → TITLE ──INVIO──▶ WIZARD ──fine──▶ OFFICE ◀──▶ DIALOGUE
                                          │  ▲
                                         Esc │ riprendi
                                          ▼  │
                                         PAUSE (fullscreen toggle / esci)
```

- `Game` (autoload) possiede lo stato, il profilo giocatore (avatar, nome team)
  e il cambio scena. `DIALOGUE` e `PAUSE` sono overlay sopra `OFFICE`.

## Scene

| Scena | File | Contenuto |
|---|---|---|
| Title | `scenes/title.tscn` | wordmark JHT stile terminale, griglia, "PREMI INVIO" |
| Wizard | `scenes/wizard.tscn` | onboarding guidato dall'Assistente (ritratto): avatar → "carica CV" (FileDialog vero, parsing finto) → nome team |
| Office | `scenes/office.tscn` | la box navigabile: mondo, giocatore, 6 agenti, HUD, dialoghi |
| Dialogue UI | `scenes/ui/dialogue_ui.tscn` | ritratto animato + box testo typewriter + scelte |
| Pause | `scenes/ui/pause_menu.tscn` | overlay: riprendi / finestra-fullscreen / esci |

## Mappa dell'ufficio (mondo ~2500×1500, camera segue con margini)

```
┌────────────────────────── vetro (glow ciano) ──────────────────────────┐
│  LOUNGE Mentor          LIBRERIA      CAFFÈ        LAB (vetro interno) │
│  [divano][tavolino]     [scaffale]    [macchina]   [banco Analista]    │
│  [poltrona][lampada]                               [microscopio]       │
│                                                                        │
│  LAVAGNA score board          (o)  ologramma               [scaffale]  │
│  [Coordinatore]            pedana + globo verde            [piante]    │
│                                                                        │
│  [desk Assistente]      [desk Scout]      [postazione Scorer:          │
│   (vicino entrata)      [desk pod ×2]      monitor curvo ultrawide]    │
│                                                                        │
└──────────────── vetro ──────────────────────────── vetro ──────────────┘
   ▲ fuori dalla box, in basso a sx: 2 Maintainer in camice che osservano
```

- Profondità: Y-sort su mobili + personaggi; mobili di 3/4, personaggi
  frontali/laterali. Pavimento riflettente scuro con griglia sottile.
- Collisioni: StaticBody2D sui mobili. Pathfinding: NavigationRegion2D
  (pavimento meno i mobili) per click-to-move e vagabondaggio agenti
  (pausa caffè, giro all'ologramma).

## Personaggi

- Rig unico `scenes/characters/character_rig.tscn`: Sprite2D a layer
  (ombra, gambe ×2, torso+braccia, testa) da SVG separati; walk = swing
  gambe + bob via codice; idle "che lavora" = digitazione/lettura (bob
  braccia/testa). Direzioni: fronte, retro, lato (flip orizzontale).
- Agenti nel slice: Coordinatore, Scout, Analista, Scorer, Mentor,
  Assistente — ognuno con postazione, idle di lavoro e piccoli spostamenti.
- Ritratti da dialogo: mezzo busto grande, layer corpo-posa × faccia-
  espressione; MAI statici (respiro, micro-tilt, transizione 100-200ms a
  ogni battuta). Mentor completo: 4 pose × 6 espressioni. Assistente: 2×4.
  Altri: 1-2 pose.
- Avatar giocatore: 3 basi × capelli/colori/abiti via layer tintati
  (scelti nel wizard), senza occhiali scuri.
- Formato asset e pipeline SVG→PNG@2x: vedi `ASSETS.md`.

## Dialoghi

Alberi scriptati in `scripts/dialogue/dialogues.gd` (Dictionary): nodo =
{speaker, text, pose, expression, choices|next}. Typewriter JetBrains Mono
con tick audio; scelte da tastiera (1-3 / frecce+INVIO) o mouse. Prossimità:
Area2D per agente → prompt HUD "[E] Parla con …". Contenuti mock sensati:
Mentor = consiglio carriera (albero completo), Scout = 3 posizioni trovate
oggi, Scorer = spiegazione di uno score 0-100 (solo numerico, mai etichette),
Coordinatore/Analista/Assistente = brevi. Terminologia: sempre "utente",
mai "Comandante".

## HUD

Angolo alto-sx, pannello terminale con brackets: posizioni trovate oggi,
score medio, budget (barra). Basso-centro: prompt contestuale interazione.
Dati sempre e solo via `TeamData` (autoload) → `MockDataSource`.

## Audio (minimo)

Procedurale (nessun file binario): tick typewriter, blip conferma/menu,
hum ambiente leggero. Autoload `Sfx`.

## Fuori scope

Vedi `ROADMAP.md`. Tutte le stringhe UI in italiano centralizzate in
`scripts/ui_strings.gd`, pronte per i18n (il sito supporta 7 lingue).
