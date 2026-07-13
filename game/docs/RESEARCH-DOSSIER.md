# Game Research Dossier — "The Box" (versione gamificata di Job Hunter Team)

> Materiale di supporto per le sessioni che sviluppano `game/` (branch `work3-dev1`). Complementare a `GDD.md` e `PROMPT.md`.
> Ricerca web verificata a luglio 2026. Tutti i repo GitHub citati sono stati verificati via fetch.
>
> ⚠️ **Nota engine**: il prototipo è già implementato in **Godot 4 + GDScript** (vedi GDD). La §7.1 (raccomandazione Phaser) è stata scritta prima di conoscere questa scelta: tenerla come contesto sull'ecosistema web-game, NON come indicazione di migrare. Tutto il resto (meccaniche, ritratti, riferimenti visivi, loop) è engine-agnostico e Godot copre nativamente ciò che lì è citato come plugin (Y-sort nativo, TileMap, luci 2D, `CanvasLayer` per l'HUD).

## Sintesi (IT)

Non esiste nessun prodotto che combini un mondo esplorabile con un team di agenti AI per la ricerca lavoro: i vicini più prossimi (JobQuest, Teal, You Got Laid Off) si fermano alla gamification da dashboard. È uno spazio bianco reale.

Le decisioni chiave che emergono dalla ricerca:

1. **Architettura**: niente server multiplayer — un solo umano + agenti il cui stato vive nei dati (pattern AI Town / AgentOffice); mondo di gioco + UI dialogo separata sopra (in Godot: `CanvasLayer`).
2. **Mappe: Tiled** con object layer e proprietà (`agentId: "mentor"`) come fa WorkAdventure; movimento tile-based con pathfinding A*/BFS.
3. **Ritratti dialogo: niente rigging.** Modello Hades + Night in the Woods: 1 illustrazione hero per agente + 2–4 varianti emotive, guidate da tag emozione inline nell'output LLM (`[fiducioso]`, `[preoccupato]`) mappati su posa+espressione. Blink timer + respiro sinusoidale per non farlo sembrare statico.
4. **Nord visivo: Disco Elysium** (isometrico noir dipinto, camera fissa "come un quadro") + **Backbone** (arte piatta + luci reali/neon/nebbia) — coerenti con `the-box.png`: box di vetro con bordi neon blu, lampade calde, stile graphic-novel inchiostrato.
5. **Loop di gioco: quest log = candidature, XP = preparazione, streak con "freeze" alla Duolingo, mappa progressi = corkboard sul muro dell'ufficio.**

---

## 0. Ancora stilistica interna (repo)

Asset già esistenti in `web/public/` (branch dev1):

- `the-box.png` — box di vetro isometrica, bordi neon blu, ufficio notturno, sviluppatori in camice fuori dalla box che osservano. **Questa è la scena del gioco.**
- `agents-*.png` (mentor, scouts, writer, analyst, coordinator, critic, doctor, treasurer, scorer, assistant, maintainer) — ritratti full-body, stile inchiostrato/graphic-novel, palette terrosa + occhiali scuri. **Questi sono i ritratti-dialogo di partenza** (il mentor con bastone e libro è già una "hero pose" alla Hades).
- Pagina di riferimento: `web/app/project/page.tsx`.

Conseguenza: la ricerca esclude il pixel art. I riferimenti sotto sono scelti per uno stile **hand-drawn noir, non pixelato**.

---

## 1. Piattaforme "ufficio virtuale esplorabile" (meccaniche + codice)

### 1.1 Fork candidates (licenze permissive — si può copiare codice)

| Progetto | Repo | Licenza | Stack | Cosa rubare |
|---|---|---|---|---|
| **SkyOffice** | github.com/kevinshen56714/SkyOffice | MIT | Phaser 3 + Colyseus + React/Redux | **L'architettura intera**: canvas Phaser + overlay React con stato condiviso; prompt "Press E to talk"; speech bubble sincronizzate con la chat log |
| **AI Town** | github.com/a16z-infra/ai-town | MIT | Convex + PixiJS + React, LLM-agnostico (Ollama/OpenAI) | Schema memoria agenti (embeddings + recency/importance); il trucco "il player è solo un altro agente"; pipeline Tiled→JSON (`data/convertMap.js`, `data/characters.ts`) |
| **AgentOffice** ⭐ | github.com/harishkotra/agent-office | MIT (feb 2026) | Phaser + Colyseus + React, Ollama, SQLite+embeddings | **La cosa più vicina alla nostra app**: agenti che camminano alle scrivanie, think-loop ~15s → `{thought, action, target, toolCall}`; camera click-to-follow su un agente; TaskBoard per assegnare task; emote bubble (💻💬🔧) di stato; layout editor drag-and-drop. Screenshot e video demo nel README (gli URL diretti delle immagini sono firmati e scadono). Demo video: youtu.be/GgrK8K9RlIA |
| **Pixel Agents** | github.com/pablodelucca/pixel-agents | MIT | Canvas 2D + React 19, BFS pathfinding, no engine | Mappatura stato-agente → animazione (working/reading/waiting); bubble = "serve il tuo input"; asset pack open con `manifest.json` per item; layout editor |
| **Generative Agents (Stanford Smallville)** | github.com/joonspk-research/generative_agents | Apache-2.0 | Python/Django + Phaser front | Il loop canonico **memory stream → retrieval → reflection → planning**; seed degli agenti via CSV → seedare i nostri con CV/stato ricerca dell'utente |

### 1.2 Riferimenti UX (closed source — solo idee)

- **Gather** (gather.town, ora "Gather 2.0", solo virtual office): **proximity ring** visibile attorno all'avatar; conversazioni che sfumano con la distanza; **status bubble sopra la testa** ("free/busy/…" → per noi "sto scansionando LinkedIn…"); **wave-to-summon** (clicchi un agente e ti viene incontro). Screenshot: `https://framerusercontent.com/images/KxCGvHrugQWXfjN6yztHZcQOz8U.png`, `https://framerusercontent.com/images/dxx1kybKiSZTlriXiPw13bS6VY8.png`
- **WorkAdventure** (github.com/workadventure/workadventure, AGPL+Commons Clause → **non copiare codice**, copiare convenzioni): mappe Tiled con proprietà (`openWebsite`, `silent`, `exitUrl`, zone) e scripting API `WA.*` (zone enter/leave → apri popup). Docs: docs.workadventu.re/developer/map-scripting/. La nostra versione: object layer con `agentId` → entri nella zona → si apre il pannello agente.
- **ZEP** (zep.us): template di mappe + minigiochi, SDK di scripting JS.
- **Teamflow** (chiuso ~2025) e **Branch** (morto): monito — gli uffici virtuali puri sono morti; la differenza nostra è la **utility gamificata**.
- Catalogo completo del genere: github.com/billmei/every-proximity-chat-app
- Segnale di genere 2026: **Aivilization** (aivilization.ai) — "guardare agenti AI vivere" è ormai un genere.

### 1.3 Decisioni tecniche derivate

- **Niente multiplayer server** (Colyseus) per il prototipo: stato agenti in Supabase (realtime ≈ subscriptions Convex di AI Town), il client renderizza e interpola.
- **Movimento tile-based** (griglia + A*/BFS): collisioni = flag di tile, target di cammino = tile nominati (`desk_mentor`).
- **Trigger chat, 3 ricette provate**: (a) distanza con isteresi (SkyOffice); (b) zona Tiled con `agentId` (WorkAdventure); (c) proximity → prompt "Premi E per parlare" → conferma esplicita. **Consigliata: (c)**, evita chat accidentali.

---

## 2. Sistema ritratti-dialogo (il cuore dell'esperienza)

### 2.1 Modelli studiati e budget di pose

| Gioco | Varianti per personaggio | Organizzazione |
|---|---|---|
| Ace Attorney | 4–20 pose, ognuna con loop idle+talking | loop per posa, blink derivato dai frame talking, transizioni one-shot (pugno sul tavolo) |
| VA-11 Hall-A | 2–4 pose × 4–8 espressioni (principali) | swap dell'intero sprite PNG |
| Coffee Talk | ~6–10 espressioni + idle loop | full swap + animazione ambientale (blink, respiro, vapore) |
| **Hades** ⭐ | **1 base + 1–4 varianti emotive (59 ritratti in tutto il gioco)** | illustrazioni statiche dipinte — la posa recita, non l'animazione |
| Persona 5 | ~4–8 espressioni per bust | swap con animazione minima, staccate dal mondo con contorni bianchi netti |
| Norma industria VN | 8–12 core, fino a ~28 | corpo base + layer viso (pattern `layeredimage` di Ren'Py) |

### 2.2 Ricetta consigliata per i nostri agenti

Per agente: **2–3 pose corpo + 6–8 stati viso come layer PSD**, loop bocca 2 frame, blink timer, trasformazione "respiro" sinusoidale 1–2px sull'intero ritratto. Slide-in dal bordo schermo con leggero settle (Hades), transizione "slash" per il primo incontro (Persona 5).

**Pattern chiave per agenti LLM (Night in the Woods / Yarn Spinner):** il dialogo porta tag emozione inline — quando il runner incontra `[smug]`/`[worried]` cambia posa+viso. Per noi: **l'LLM emette il tag emozione per ogni battuta**, il runner lo mappa su variante ritratto. Fonte: secretlab.games/blog/2017/11/14/how-night-in-the-woods-uses-yarn-spinner
Bonus: shader "wobbly ink line" per le vignette disegnate a mano: medium.com/@galbartouv/shader-breakdown-recreating-night-in-the-woods-wobbly-dialogue-effect-bf454cfdac62

### 2.3 Due livelli di dialogo (Oxenfree)

- **Ambientale**: piccole bubble ancorate ai personaggi nel mondo (chiacchiere di ufficio, stati "sto lavorando su X").
- **Focalizzato**: ritratto grande a lato schermo + input libero — solo quando ti avvicini e confermi.

### 2.4 Screenshot di riferimento (URL diretti, CDN Steam stabile)

- Ace Attorney: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/787480/ss_4d25ad6f263d48f04550c8ed0d4e787e5a1b6080.1920x1080.jpg`
- VA-11 Hall-A: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/447530/ss_2e423af338f78a728112aefc4dbada0050715ae2.1920x1080.jpg`
- Coffee Talk: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/914800/ss_7df86693fd63aae5209cb3157e2b98f3e7074cdf.1920x1080.jpg`
- Hades (ritratto in dialogo): `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/ss_8a9f0953e8a014bd3df2789c2835cb787cd3764d.1920x1080.jpg`
- Persona 5 Royal: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1687950/ss_663171dc3afce8fe987e57e8659f91b69faa39bc.1920x1080.jpg`
- Oxenfree (bubble nel mondo): `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/388880/ss_72abbfd384f1825b6d68ed8977b373b78dfbc30f.1920x1080.jpg`
- Night in the Woods: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/481510/ss_f038268bdcef20dc090dca4e0ac8fbed4923c496.1920x1080.jpg`
- Catalogo sprite Ace Attorney: court-records.net/sprites1.htm · spriters-resource.com/pc_computer/phoenixwrightaceattorneytrilogy/

---

## 3. Riferimenti visivi: isometrico noir hand-drawn

### 3.1 Disco Elysium — il nord ⭐

- Sfondi: scene 3D di blocco **ridipinte a mano** in Photoshop; **normal map dipinte a mano** perché la luce cada "come pensa un illustratore". Camera isometrica fissa: *"puoi progettare l'intero gioco come se fosse un quadro"* (Rostov).
- Il suo pannello dialogo laterale con ritratti dipinti **valida il nostro layout** (ritratto a lato in un mondo isometrico esplorabile).
- Da copiare: camera fissa/zoom leggero; pozze di luce dipinte (le nostre lampade!) + pochi accenti dinamici; silhouette leggibili su pavimenti a valore controllato.
- Screenshot: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/632470/ss_b3694e99ffdb686d1bbbbe16a540d3d2ccd509c4.1920x1080.jpg` · dialogo: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/632470/ss_9125a718ee9ba85386ae5d4eb820f3266073fc97.1920x1080.jpg`
- Fonti: vertexmode.com/the-art-of-disco-elysium/ · pcgamer.com/games/rpg/why-does-isometric-perspective-suit-disco-elysium-you-can-design-the-entire-game-as-if-it-was-a-painting/

### 3.2 Backbone (Tails Noir) — ricetta luci 2.5D

Arte piatta a layer + **luci dinamiche reali, nebbia volumetrica, neon, pioggia** tra i layer parallax. Per noi in canvas: gradienti radiali additive per le pozze di lampada + strip emissive screen-blend per i bordi neon della box = 80% dell'effetto gratis.
Screenshot: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/865610/ss_e950f52ee4d972c135d1acbd70def74e9eb497b9.1920x1080.jpg`
Fonte: unrealengine.com/en-US/developer-interviews/developer-eggnut-highlights-how-they-created-backbone-s-dystopian-noir-2-5d-pixel-art-style

### 3.3 Altri

- **The Red Strings Club**: la conversazione È il gameplay; palette teal/ambra identica in spirito alla nostra (neon blu + lampade calde). `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/589200/ss_8f478b6cf317bb33dcd35441aa15f37e01b6684a.1920x1080.jpg`
- **Norco**: ritmo scena-ritratto-testo; una fonte di luce = un beat narrativo per stanza. `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1221250/ss_665735a220bfddfeabd16bb50ca27ab6c42e75a1.1920x1080.jpg`
- **Gomorrah** (34BigThings, 2023, italiano): VN illustrata dark, linguaggio inchiostro pesante tonalmente vicino ai nostri agenti. `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2017380/ss_f82037e70a28306125a5d7dd6656c72b94b85e9e.1920x1080.jpg`

### 3.4 Tecnica 2.5D in 2D

- **Y-sorting**: sort per punto di contatto a terra; `depth = cartX + cartY + z`. Phaser: idioma `setDepth(y)` — esempio ufficiale: phaser.io/examples/v3.85.0/depth-sorting/view/isometric-blocks. Scrivanie/muri lunghi: spezzarli in chunk per tile o dare sort anchor espliciti (gamedevelopment.tutsplus.com/tutorials/isometric-depth-sorting-for-moving-platforms--cms-30226).
- **Parallax diorama**: 3–5 piani per stanza (pavimento+muro → mobili → personaggi → vetro/neon → sfocatura in primo piano); anche ±2–3% di parallax fa leggere la box come diorama.

---

## 4. Giochi ufficio: pattern di gameplay

- **Going Under** ⭐ — hub loop identico al nostro: giri l'ufficio startup, parli ai colleghi alle scrivanie per dialoghi/task/perk da mentore. Indicatore visibile "ha qualcosa per te" sugli NPC. `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1154810/ss_8f0a8f20fc5b04639f5b7d95c879298eb17202d2.1920x1080.jpg`
- **Yes, Your Grace** ⭐ — il loop **invertito**: i petitioner vengono da te in coda, ogni conversazione = ritratto + richiesta + decisione su risorse scarse. Per noi: gli agenti vengono alla TUA scrivania con risultati/domande; decisioni che spendono risorse (crediti, budget API). `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1115690/ss_2e9fca63997b454b0084cc30aac2ff82319de33d.1920x1080.jpg`
- **Two Point Hospital** — leggibilità god-cam: muri di vetro (mai occlusione sugli agenti — la nostra box di vetro è già questo trucco in versione noir), zoom-band (lontano = piano intero leggibile; vicino = emote individuali), bubble di stato sopra le teste. `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/535930/ss_513fe00a570aae8aa17f0c7c34441d900ecea67d.1920x1080.jpg`
- **The Stanley Parable** — storytelling ambientale per scrivania: la personalità dell'agente leggibile dagli oggetti prima ancora di parlarci; voce narrante reattiva al vagare.

---

## 5. Onboarding / creazione avatar

- Browse veloce di 55k+ screenshot UI reali: gameuidatabase.com/index.php?scrn=38 (categoria Character Creator).
- Pattern che funzionano: (1) **preview live al centro** — l'avatar È lo schermo, nello stesso stile dei ritratti-dialogo; (2) **tab categorie + griglie di swatch, NON slider** (l'arte 2D a layer non interpola); (3) **pulsante random/dado** come primo tocco; (4) **framing diegetico**: creator = "foto badge HR" nell'ufficio noir, flash della foto = conferma (cfr. South Park: The Stick of Truth).
- Flusso consigliato: creator → animazione stampa badge → **l'ascensore si apre sull'ufficio isometrico** → la prima conversazione (con il Coordinator/Mentor che ti saluta col nome sul badge) è il tutorial.
- Template architetturale part-swapping: assetstore.unity.com/packages/2d/characters/character-creator-2d-111398 (ogni slot = layer group con canale color-mask).

---

## 6. Gamification loop (mappati sul job hunting)

Nessun "Duolingo for job search" esiste. Precedenti verificati: **JobQuest** (side-project Next.js+Supabase+Gemini — quasi il nostro stack: XP per azione, 50+ badge — medium.com/@leonkabarity/building-jobquest-...), **Teal** (kanban come progress bar implicita), **You Got Laid Off** (satirico: "motivation index" da spendere in upgrade), **JobFlare** (approccio inverso: minigiochi come assessment).

Mappatura consigliata:

| Pattern | Nel nostro gioco | Fonte |
|---|---|---|
| Quest log | Candidature come quest a stadi (applied → screen → interview → offer); gli Scout sono i quest-giver | trophy.so/blog/productivity-gamification-examples |
| XP / livelli | Preparazione colloqui, completezza profilo | Octalysis: yukaichou.com/gamification-examples/octalysis-gamification-framework/ |
| Streak | Abitudine quotidiana **con streak freeze** (loss-aversion addolcita — indispensabile per un'attività stressante) | trophy.so/blog/duolingo-gamification-case-study (retention 12%→55%) |
| Mappa progressi | Corkboard/mappa città sul muro dell'ufficio | deconstructoroffun.com/blog//2013/05/beating-candy-crush-saga.html |
| Collezionabili | Skill/badge (tassonomia ~50 alla JobQuest) | — |
| Energia | Cap sulle candidature = controllo qualità anti spray-and-pray (dark pattern F2P che qui è **pro-utente**) | Octalysis Core Drive 6 |

Nota verificata: NON esistono talk GDC/Deconstructor of Fun dedicati alla gamification del job search — citare le fonti generali sopra.

---

## 7. Stack tecnico consigliato

### 7.1 Engine: Phaser (3.87+ ora → Phaser 4)

| Opzione | Verdetto |
|---|---|
| **Phaser 3/4** ✅ | Tilemap isometrici nativi (dal 3.50), y-sort one-liner, ecosistema RexUI per dialoghi, precedente Vampire Survivors. **Phaser 4 (aprile 2026)**: renderer WebGL nuovo, Filter unificati (Blur/Vignette/**GradientMap** — perfetto per il grading noir), lighting 2D `sprite.setLighting(true)`. Migrazione 3→4 "a few hours" (guida ufficiale). Partire su 3.87+, upgrade a 4 quando Rex plugins confermano supporto |
| PixiJS v8 | Solo renderer, tutto a mano — solo se si vuole controllo totale |
| Godot 4 web | Overkill: 9MB+, editor separato, e il codice LLM/Supabase vive comunque in JS |
| Kaplay / Excalibur | Da jam / runner-up TS pulito, ecosistemi piccoli |

⚠️ Il vecchio plugin isometrico `lewster32/phaser-plugin-isometric` è Phaser-2-only e morto — non usarlo; tilemap nativi + depth manuale.

### 7.2 Electron full-screen

- Precedente: **Vampire Survivors = Phaser 3 + Electron su Steam** (migrato a Unity solo per console/mobile). Recente: Desktop Heroes (Steam, ott 2025, Phaser+Electron).
- Pattern: `new BrowserWindow({ fullscreen: true, frame: false, autoHideMenuBar: true })` — **preferire `fullscreen: true` con toggle Esc/F11, NON `kiosk: true`** per un gioco; listener su `crashed` → relaunch; cursore nascosto via CSS in idle.
- Guida packaging Steam/Electron: phaser.io/news/2025/03/publishing-web-games-on-steam-with-electron
- UI dialogo come DOM overlay = input testo nativo, IME, scroll, accessibilità gratis (cruciale per chat LLM).

### 7.3 Pipeline asset (non-pixel)

- **Animazione ritratti: nessun rigging.** Layered PSD → varianti sprite (vedi §2.2). Alternative se servisse: Spine ($379 one-time), Live2D (~$100/anno indie, deforma l'illustrazione preservando le pennellate ma runtime web più complesso), DragonBones (free ma non mantenuto). Hades dimostra che con illustrazioni forti non serve nulla di tutto ciò.
- **Coerenza personaggi con AI (stato 2026)**: pipeline reference-first — LoRA per personaggio su checkpoint di stile condiviso (10–20 immagini), image-to-image per varianti di posa, paintover umano obbligatorio; tetto pratico ~85–90% di coerenza. Tool: Scenario (scenario.com), Lovart, benchmark: toonystory.com/blog/best-ai-for-character-consistency-2026. Per i nostri ~11 agenti fissi in uno stile: 1 LoRA per personaggio è molto fattibile.
- **Asset isometrici non-pixel**: non esiste NESSUN pack "ufficio noir" pronto — comprare un pack ufficio neutro e ridipingere/gradare, o commissionare. Fonti: itch.io/game-assets/tag-office · itch.io/game-assets/tag-asset-pack/tag-isometric (escludere tag pixel) · craftpix.net (pack vettoriali con sorgenti AI/EPS → ricolorabili noir). Kenney = blockout only (stile 3D minimal).

### 7.4 Chat LLM in-game (UX osservate nei titoli shipped)

- **Suck Up!** (l'esempio canonico): push-to-talk O testo libero; NPC valuta logica/tono contro profilo di personalità con memoria.
- **Whispers from the Star** (Anuttacon 2025): zero alberi di dialogo, pura chat aperta con un personaggio — il parente UX più vicino a "parlare col tuo team di agenti".
- Pattern consolidati: (1) proximity prompt → modalità chat focalizzata con input di gioco sospeso; (2) input testo come **oggetto diegetico** (terminale, telefono); (3) risposta in streaming con animazione talking; (4) **chip di risposte suggerite accanto al testo libero** (riduce l'ansia da pagina bianca — Hidden Door); (5) attenzione a prompt injection sugli NPC (arxiv.org/pdf/2508.19288) — rilevante perché i nostri agenti maneggiano dati reali dell'utente.
- Middleware (Inworld, Convai): **non servono** — i cervelli degli agenti li abbiamo già; serve solo il presentation layer.
- Panorama: wanderfolk.ai/best-ai-npc-games-2026/ · post-mortem sobrio: frisson-labs.com/ai-npcs-2026

---

## 8. Indice header Steam (per moodboard rapide)

Pattern stabile: `https://cdn.cloudflare.steamstatic.com/steam/apps/{APPID}/header.jpg`
Disco Elysium 632470 · Hades 1145360 · Persona 5 Royal 1687950 · Coffee Talk 914800 · VA-11 Hall-A 447530 · Ace Attorney Trilogy 787480 · Oxenfree 388880 · Night in the Woods 481510 · Backbone 865610 · Norco 1221250 · Red Strings Club 589200 · Gomorrah 2017380 · Going Under 1154810 · Yes Your Grace 1115690 · Two Point Hospital 535930 · Stanley Parable UD 1703340 · Suck Up! 2726370

---

## 9. Idee da questa ricerca da valutare per il prototipo Godot (oltre il GDD attuale)

1. Trigger dialogo a conferma esplicita: proximity → prompt "Premi E" → dialogo (evita chat accidentali; ricetta SkyOffice/WorkAdventure). `Area2D` per zona-scrivania con metadato `agent_id`.
2. Ritratti: tag emozione inline nell'output (anche mock) → variante posa/viso (pattern Night in the Woods/Yarn Spinner); blink timer + respiro sinusoidale 1–2px; slide-in con settle (Hades); bubble wobbly-ink via shader.
3. Due livelli di dialogo (Oxenfree): bubble ambientali sopra gli agenti ("sto scansionando LinkedIn…") + dialogo focalizzato col ritratto grande.
4. Loop invertito (Yes, Your Grace): gli agenti vengono alla scrivania del giocatore con risultati/domande, in coda visibile.
5. Storytelling ambientale per scrivania (Stanley Parable): la personalità dell'agente leggibile dagli oggetti prima di parlarci; indicatore "ha qualcosa per te" (Going Under).
6. Onboarding diegetico: wizard = "foto badge HR", flash = conferma; ascensore che si apre sull'ufficio.
7. Loop meta: quest log candidature a stadi, streak con freeze (Duolingo), corkboard progressi sul muro, energia = cap candidature pro-qualità.
8. Camera: click su un agente → follow (AgentOffice); zoom-band alla Two Point (lontano = piano leggibile, vicino = emote).
