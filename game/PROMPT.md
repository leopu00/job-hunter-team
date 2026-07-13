# PROMPT — Prototipo videogioco "JHT: The Office" (esperienza gamificata di Job Hunter Team)

## Missione

Costruisci da zero, nella cartella `game/` di questa monorepo, il prototipo di un **videogioco 2D "avanzato" (2.5D)** che gamifica l'esperienza utente di Job Hunter Team: l'utente è un personaggio che cammina in un ufficio dove lavorano gli agenti AI del suo team di ricerca lavoro, si avvicina a un agente e ci parla. Non è un arcade: è un'applicazione utile per cercare lavoro, ma vissuta come un videogioco full-immersion. Questo è un **prototipo standalone**: se piace, verrà mergiato in futuro con l'app desktop esistente.

## Contesto repo (leggi prima di scrivere codice)

Job Hunter Team (JHT) è una piattaforma dove un team di agenti AI cerca lavoro per l'utente: trova posizioni, le analizza, le valuta con uno score 0-100, scrive CV su richiesta. La monorepo contiene già:

- `web/` — sito pubblico Next.js + dashboard (7 lingue). **Solo lettura per te.**
- `desktop/` — app Electron esistente. **Solo lettura per te.**
- `agents/` — prompt e skill degli agenti reali. **Solo lettura**, utile per capire personalità e ruoli.

File da studiare come riferimento visivo e di contenuto:

- `web/public/the-box.png` (1672×941) — **il riferimento principale per la scena di gioco**: un cubo/box di vetro che racchiude un ufficio in miniatura con gli agenti al lavoro; fuori, i maintainer che osservano. L'ufficio del gioco è questo, visto dall'interno.
- `web/public/agents-*.png` (12 file, 1448×1086) — i personaggi già disegnati, **riferimento di stile obbligatorio**: `agents-coordinator.png`, `agents-scouts.png`, `agents-analyst.png`, `agents-scorer.png`, `agents-writer.png`, `agents-critic.png`, `agents-treasurer.png`, `agents-doctor.png`, `agents-maintainer.png`, `agents-mentor.png`, `agents-assistant.png`, `agents-assistant-male.png`. Aprili e studiali prima di disegnare qualsiasi personaggio.
- `web/public/landing-team.png`, `web/public/landing-hero.png` — altre scene d'insieme nello stesso stile.
- `web/app/globals.css` (righe ~6-34) — i design token del brand, da riusare come palette di gioco.
- `web/app/agents/page.tsx` — nomi, ruoli e descrizioni dei 12 agenti in 7 lingue.
- `web/app/project/page.tsx` — la pagina "Project" con la narrazione della box.

## Stile visivo (vincolante)

- **NON pixel art.** Lo stile è quello dei PNG `agents-*.png`: illustrazione flat/pulita, personaggi proporzionati, colori coordinati col brand. Prendi ispirazione architetturale (non stilistica) da progetti come **AI Town** (a16z) e **gather.town**: uffici 2D top-down, agenti che si muovono, interazione di prossimità — studia pure il loro approccio (tilemap, pathfinding, trigger di prossimità), ma la resa grafica deve restare quella del nostro sito.
- Palette dal brand (`web/app/globals.css`): sfondi quasi-neri a tinta lavanda (`#060608`, `#0c0c10`, `#111116`, `#16161d`), bordi `#252530`, testi lavanda (`#b8b8d0` → `#f0f0fa`), **verde brand `#00e87a`** + mint `#7fffb2` per accenti/HUD, più `#f5c518` giallo, `#4d9fff` blu, `#ff4560` rosso, `#a855f7` viola per stati e varietà.
- Font: **JetBrains Mono** ovunque nella UI (è il font brand; scaricalo/embeddalo nel progetto Godot).
- UI di gioco = estetica **terminale/HUD**: bordi netti squadrati (niente border-radius), brackets verdi a L agli angoli dei pannelli (come sul sito), griglia di sfondo sottilissima. Menu, dialoghi e wizard devono sembrare la console di JHT, non un JRPG.
- "2.5D": vista top-down con leggera prospettiva (mobili visti di 3/4, personaggi visti frontali/laterali), profondità via **Y-sort**, parallasse leggera. Come the-box.png ma navigabile.

## Stack tecnico (vincolante)

- **Godot 4.x** (ultima stable), linguaggio **GDScript**. Se Godot non è installato: `brew install --cask godot`.
- Progetto in `game/` con struttura pulita: `game/project.godot`, `game/scenes/`, `game/scripts/`, `game/assets/`, `game/docs/`.
- **Fullscreen di default** all'avvio (Esc → menu pausa con toggle finestra/uscita). È un videogioco che si apre e si inizia, non una finestra fluttuante.
- Target di test: **macOS** (l'utente sviluppa e prova su Mac). Niente export multi-piattaforma per ora.
- Risoluzione di progetto 1920×1080 con stretch mode `canvas_items` (scala pulita su schermi diversi).

## Asset dei personaggi (parte critica — dedicagli cura)

I PNG esistenti sono monolitici e con una sola posa: **non ritagliarli**. Devi ricreare i personaggi come **SVG vettoriali componibili** che imitano lo stile dei PNG di riferimento:

- Sorgenti SVG in `game/assets/characters/src/`, **a layer separati**: corpo, testa, braccia, gambe, espressione (occhi/bocca/sopracciglia), oggetti di scena (laptop, tazza, clipboard). Così le pose e le espressioni si combinano via codice/scene, non ridisegnando tutto.
- Per ogni personaggio due livelli di dettaglio:
  1. **Sprite in-world** (semplificato, ~64-96px di altezza effettiva): 4 direzioni o almeno 2 (fronte + lato flippabile), ciclo camminata a 2-4 frame, idle "che lavora" (digitazione, lettura).
  2. **Ritratto da dialogo** (dettagliato, mezzo busto grande, stile fedele ai PNG): per il/i personaggi del vertical slice servono **almeno 4 pose del corpo × 6 espressioni facciali** combinabili.
- Nota Godot: gli SVG vengono rasterizzati all'import — imposta la scala di import perché ritratti e sprite risultino nitidi a 1080p (o esporta PNG@2x dagli SVG in una pipeline documentata in `game/docs/ASSETS.md`).
- Requisito d'esperienza sui dialoghi: **il ritratto non è mai statico**. A ogni battuta il personaggio cambia leggermente posa e/o espressione (coerenti col tono della frase), con una micro-transizione (fade/slide di 100-200ms) e una lieve animazione idle continua (respiro, blink). Deve sembrare un personaggio che ti parla, non un'immagine.

## Il roster (per dialoghi e scena sensati)

Nomi pubblici e ruoli (da `web/app/agents/page.tsx`): **Il Coordinatore** dirige il team; **Lo Scout** trova le posizioni; **L'Analista** le analizza a fondo; **Lo Scorer** assegna lo score 0-100; **Lo Scrittore** prepara i CV (solo on-demand); **Il Critico** revisiona; **Il Tesoriere** sorveglia il budget; **Il Dottore** e **Il Mantenitore** curano la salute del team; **Il Mentor** consiglia l'utente sulla carriera; **L'Assistente** accoglie e fa onboarding. Terminologia: chi gioca è sempre "l'utente/il giocatore" (**mai "Comandante"**); score solo numerico 0-100, mai etichette tipo "practice/seria".

## Vertical slice (scope esatto del prototipo)

Flusso completo, **tutto con dati mock** — nessuna chiamata a backend reale, nessuna API key:

1. **Boot + title screen**: logo/wordmark JHT in stile terminale, "premi INVIO".
2. **Setup wizard** (in-game, stessa estetica HUD): scelta e personalizzazione avatar del giocatore (2-3 basi × varianti colore/capelli/abito, riusando il sistema a layer SVG); "caricamento CV" simulato (file picker vero, parsing finto con barra di progresso e feedback divertente); nome del team. Guidato dall'**Assistente** come primo dialogo a ritratti.
3. **L'ufficio**: un piano unico ispirato a the-box.png — scrivanie, monitor, lavagna con lo score board, zona caffè, la parete di vetro oltre cui si intravedono i maintainer che osservano. 5-6 agenti presenti (Coordinatore, Scout, Analista, Scorer, Mentor, Assistente), ognuno con la sua postazione, idle di lavoro e piccoli spostamenti autonomi (pathfinding semplice, tipo pausa caffè).
4. **Movimento del giocatore**: WASD/frecce + click-to-move, collisioni con i mobili, camera che segue con margini.
5. **Interazione di prossimità**: avvicinandosi a un agente compare un prompt contestuale in stile HUD ("[E] Parla con lo Scout"); premendo si entra in dialogo.
6. **Dialogo a ritratti**: il ritratto grande del personaggio compare a lato schermo con la vignetta/box di testo (typewriter effect, JetBrains Mono); pose/espressioni cambiano a ogni battuta (vedi sopra). Dialoghi **scriptati ad albero** con scelte del giocatore. Contenuti mock ma sensati per ruolo: il Mentor dà un consiglio di carriera, lo Scout mostra "3 posizioni trovate oggi" (dati finti), lo Scorer spiega uno score. Almeno il **Mentor** con l'albero completo e il set pieno di pose/espressioni; gli altri possono avere dialoghi brevi.
7. **HUD di gioco**: angolo con stato team mock (posizioni trovate oggi, score medio, budget) in stile terminale.

**Layer dati**: tutti i dati di gioco (agenti, posizioni, score, budget, stato team) passano da un'interfaccia unica `game/scripts/data/team_data_source.gd` con implementazione `MockDataSource`. Documenta in `game/docs/DATA-ADAPTER.md` il contratto, così in futuro si aggancia il backend reale (Supabase / API dashboard) senza toccare il gioco.

**Fuori scope (non farlo, al massimo annotalo in `game/docs/ROADMAP.md`)**: versione 3D, chat LLM reale, collegamento a dati reali, multiplayer, altre stanze/piani, salvataggio cloud, export Windows/Linux, i18n completa (scrivi però tutte le stringhe UI in un unico file/dizionario centralizzato, in italiano, pronte per la traduzione — il sito supporta 7 lingue).

## Metodo di lavoro e norme repo (vincolanti)

- Lavora **solo dentro `game/`** (+ eventuale riga in `.gitignore` root per artefatti Godot come `game/.godot/`). Non toccare `web/`, `desktop/`, `agents/` né altri file root.
- Prima di scrivere codice, butta giù un **GDD sintetico** in `game/docs/GDD.md` (1-2 pagine: scene, mappa dell'ufficio in ASCII, macchina a stati del gioco, formato asset) e poi implementa per milestone: (1) progetto Godot + fullscreen + ufficio placeholder + movimento; (2) sistema personaggi SVG + agenti in scena; (3) dialoghi a ritratti; (4) setup wizard; (5) polish HUD/audio minimo.
- **Verifica end-to-end a ogni milestone**: lancia davvero il gioco (`godot --path game/` o da editor), non fidarti solo dello script che compila. Fai screenshot quando utile.
- Git: lavora sul branch dev della tua sessione, **mai su master**; messaggi di commit **in inglese**; commit sostanziosi (un commit = una milestone o un blocco coerente, niente micro-commit); **push subito dopo ogni commit**; nessun nome di agente/sessione nei branch (usa `feat/...`).
- Decisioni operative: prendile in autonomia con buon senso; chiedi solo su scelte di direzione (es. cambiare stile o scope).

## Criterio di successo

Avvio il gioco: parte a schermo intero, l'Assistente mi accoglie e mi fa creare l'avatar e "caricare" il CV; mi ritrovo nell'ufficio della box, cammino tra le scrivanie dove gli agenti lavorano, mi avvicino al Mentor, parte il dialogo con il suo ritratto che cambia posa ed espressione a ogni battuta, scelgo le risposte, chiudo, e l'HUD mi mostra lo stato del team. Tutto coerente con lo stile del sito: dark lavanda, verde `#00e87a`, JetBrains Mono, bordi netti. Se un estraneo lo vede, deve dire "è un videogioco", e se conosce JHT deve dire "è la box del sito, viva".
