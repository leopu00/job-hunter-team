# JHT: The Office — GDD sintetico (prototipo / vertical slice)

> ⚠️ **AGGIORNAMENTO 2026-07-11 — il GDD sotto è STORICO.** Direzione attuale
> (ordini di Leone, launch della missione videogioco):
> - Il gioco è la **desktop app resa come box animata**: si migrano dentro le
>   viste dell'app desktop/web una alla volta (sidebar `SidebarDefs` 1:1 con
>   `desktop/renderer/index.html`).
> - **Niente giocatore né wizard**: TITLE→OFFICE diretto, FreeCamera
>   (drag/WASD/zoom), si clicca su agenti (scheda + dialogo), reparti
>   (pannello), mappamondo (mappa pin), bacheca (registro).
> - **5 reparti** (Scout→Analisti→Scorer→Scrittori→Critici) in
>   `DepartmentDefs`: 6 postazioni orientate nei 4 versi, agenti lead+worker
>   (`CharacterDefs.spawn_list()`), behavior a cadenze reali (`TRIP_EVERY`),
>   catena del valore stampante/inbox, sala relax a ovest.
> - **Stile**: gioioso/elegante/colorato, riferimento illustrazione ufficio
>   della pagina pubblica (the-box) — NON più Disco Elysium scuro. Arredi e
>   sprite via **imagegen di Codex** (mai Pillow), vedi `SPRITES.md`.
> - **Giorno/notte** sull'ora locale (`DayNight`, JHT_HOUR per test).
> - Avvio/test SOLO con `tools/run.sh boot|play|shot` (cache classi) e
>   verifica su screenshot prima di dichiarare fatto.

Un videogioco 2D top-down (2.5D via Y-sort) che gamifica Job Hunter Team: l'utente
cammina dentro "la box" — l'ufficio di vetro del sito (`web/public/the-box.png`) —
dove i suoi agenti AI lavorano, e ci parla da vicino. Non è un arcade: è
l'esperienza JHT vissuta in prima persona. Tutti i dati sono mock (vedi
`DATA-ADAPTER.md`).

- Engine: Godot 4.x, GDScript. Risoluzione 1920×1080, stretch `canvas_items`,
  fullscreen all'avvio (Esc → menu pausa).
- Stile (decisioni in `ANALISI-GIOCHI.md`): **vietati pixel art e 3D
  cartone**. Ambienti **pittorici alla Disco Elysium** (riferimento
  principale confermato; secondario Shadowrun Hong Kong): pozze di luce
  dipinte, valori controllati, materia — non flat. Livello di resa minimo
  fattibile: Yes, Your Grace. **Personaggi fedeli ai PNG `agents-*.png`**
  (occhiali tondi scuri = firma degli agenti; il giocatore NON li porta: è
  l'unico umano nella box). Palette dal brand (`web/app/globals.css`): dark
  lavanda `#060608→#16161d`, bordi `#252530`, testo `#b8b8d0→#f0f0fa`, verde
  `#00e87a` + mint `#7fffb2`, accenti giallo/blu/rosso/viola. Font JetBrains
  Mono ovunque. UI = terminale/HUD: bordi squadrati, brackets a L verdi,
  griglia di sfondo sottile.
- Movimento: **"2D tridimensionato"** — 8 direzioni con profondità
  (top-down/¾ + Y-sort). MAI side-scroller, mai 3D. Ambito: tutto al
  chiuso, dentro la box (niente open map). Niente azione: **il gameplay è
  parlare**.

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

## Spunti integrati dal RESEARCH-DOSSIER

Dal dossier (`RESEARCH-DOSSIER.md`) il prototipo integra tre pattern:

1. **UX ufficio alla Gather** (§1.2): ogni agente ha una **status bubble**
   sopra la testa che alterna stato di lavoro (da `TeamData.agent_status()`,
   es. "sto scansionando LinkedIn…") e chiacchiere ambientali — è anche la
   metà "ambientale" del modello Oxenfree (§2.3); **proximity ring** visibile
   attorno all'agente interagibile più vicino; **wave-to-summon**: click su
   un agente lontano → saluta e ti viene incontro, poi parte il dialogo.
2. **Ritratti alla Hades / Night in the Woods** (§2): ogni battuta porta un
   **tag emozione inline** (`[saggio]`, `[divertito]`, …) che il runner
   mappa su posa+espressione; blink timer, respiro sinusoidale 1–2px,
   slide-in dal bordo con settle. Il formato col tag emozione è già pronto
   per l'output LLM futuro.
3. **Luci alla Backbone / Disco Elysium** (§3): pozze di luce calda additive
   sotto le lampade + neon freddo dei bordi vetro; poche luci, dipinte, con
   silhouette leggibili su pavimento a valore controllato.

Integrati nella sessione master (2026-07-07), oltre il piano iniziale:

4. **Onboarding diegetico "foto badge"** (§5): il wizard è la foto per il
   badge HR (flash+shutter), il badge esce "dalla stampante" e
   l'ascensore si apre sulla box.
5. **Loop invertito lite** (Yes, Your Grace §9.4): coda visite — Scout e
   Scorer vengono alla tua posizione con l'indicatore "!" (Going Under),
   riga "IN ARRIVO DA TE" nell'HUD, alberi di dialogo dedicati.
6. **Meta loop** (§6): registro candidature su TAB (quest a stadi
   inviata→screening→colloquio→offerta) + streak con freeze.
7. **Asset pittorici gen-art** (pipeline con la sessione dev1-art):
   pavimento dipinto + mobili sostituiscono progressivamente il blockout
   procedurale (fallback automatico se il file manca). ⚠️ Nota tecnica:
   su macOS/GLES3 non mescolare `draw_texture_rect` con molte primitive
   nello stesso CanvasItem (batching rotto → item bianco): texture in
   Sprite2D figli.

Rimandati a `ROADMAP.md`: corkboard fisico, decisioni con risorse,
camera follow su click agente (§9.8), chat LLM.

## Dialoghi

Layout alla Going Under (`ANALISI-GIOCHI.md` §1): **personaggio in primo
piano** (ritratto grande a destra) + **vignette in sequenza** — ogni battuta
è una vignetta; le precedenti scalano verso l'alto attenuate, la corrente è
piena. Alberi scriptati in `scripts/dialogue/dialogues.gd` (Dictionary):
nodo = {text con tag emozione inline, pose?, choices|next}; il tag
(`[caldo]`, `[severo]`, …) seleziona l'espressione del ritratto. Typewriter
JetBrains Mono con tick audio; scelte da tastiera (1-3 / frecce+INVIO) o
mouse.
Prossimità: raggio per agente → prompt HUD "[E] Parla con …" a conferma
esplicita (mai chat accidentali); da lontano, click = wave-to-summon. Contenuti mock sensati:
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
