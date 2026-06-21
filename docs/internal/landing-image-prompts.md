# 🎨 Prompt immagini — Sito pubblico

Raccolta dei prompt per **tutte le immagini** del sito pubblico (landing + pagine
dedicate). Ogni placeholder nel codice porta un `promptId` che corrisponde a una
voce qui sotto. Stile e regole condivise vivono in
[`chronicles-canon.md`](./chronicles-canon.md) (sezione "Stile visivo" + regola
**occhiali da sole** Matrix identici per tutti).

Convenzione `promptId`: `area.nome` (es. `team.analisti`, `hero.main`).

---

## 🔁 Blocco STYLE condiviso (copiare in testa a ogni prompt)

> Hand-drawn **Western graphic-novel / European comic** illustration (realistic adult
> proportions — **NOT anime / manhwa / webtoon**) — clean inked outlines, flat colours,
> a **warm muted palette with subtle green accents**, light halftone / paper-grain
> texture; not 3D, not photorealistic, not a glossy AI painting. The agents are
> **mature adult professionals (late 30s–40s), experienced and confident — NOT teenagers
> or twenty-somethings, NOT youthful idealized faces.** Normal, friendly people, calm
> approachable expressions (NOT stern), varied elegant clothing (NOT all-black agent
> suits). Elegant, a touch witty. Riferimento di stile: i tre agenti della home
> (`web/public/landing-team.png`).

> 🧒 **Trappola "pischelli coreani":** "comic / graphic-novel / hand-drawn" senza
> vincoli porta il generatore verso volti **webtoon/manhwa giovanissimi**. Ancorare
> SEMPRE: età adulta (35–45) + "Western/European comic style, not anime/manhwa".

**Regola occhiali (sempre):** ogni agente indossa gli **stessi** piccoli occhiali da
sole — lenti ovali scure, discrete — come tratto distintivo condiviso del team. Sono
un dettaglio elegante: **non** devono rendere il personaggio cupo o "Agente Smith",
resta una persona normale dall'aria serena.

🕶️ **CRUCIALE — forma E copertura, sempre INSIEME.** Due vincoli che il generatore
fa collidere (correggi uno → rompe l'altro): vanno tenuti **entrambi** in ogni prompt.

1. **Forma (fissa, identica su ogni agente):** occhiali **piccoli, lenti tonde/ovali,
   montatura sottile in metallo** — come quelli del Coordinatore (`agents-coordinator.png`)
   e della home. **Mai** grandi, squadrati, wayfarer o aviator.
2. **Copertura:** le lenti, scure, **coprono completamente gli occhi** — occhi **mai
   visibili** (agenti virtuali, dietro le lenti solo buio). Indossati **alti sul naso**,
   NON abbassati né sulla punta del naso.

Formula da incollare nei prompt: *"small round/oval dark sunglasses with thin metal
frames, identical on every agent — small and discreet, the dark lenses fully hide the
eyes (no eyes visible). Keep them small and oval, NOT large or square, NOT lowered on
the nose."*

> ⚠️ **Generiamo da browser (ChatGPT/web): MAI riferimenti a file nei prompt** (no
> `ref. …png`, no path) — il generatore non vede i nostri file locali. Le immagini in
> `web/public/` e `prima-release/` sono solo appunti visivi **per noi**.

---

## `hero.main` — Hero della landing ✅ FATTO

File attuale: `web/public/landing-hero.png`. Prompt finale usato:

> [STYLE] Daytime: a team of ~10 elegantly dressed people around a long boardroom
> table in a warm, classy high-rise office, one presenting at a whiteboard,
> another on a laptop. They look toward the viewer like a candid team photo, with
> natural varied expressions — a couple with a subtle smile, the others calm and
> professional. Through the windows, a sleek modern glass metropolis from high
> above (skyline at/below the window line, no famous landmarks). No readable text
> anywhere — whiteboard shows only abstract charts; plain unbranded mugs and
> books. [REGOLA OCCHIALI]. 16:9.

---

## Landing — thumbnail di sezione (16:9)

### `landing.team` ✅ FATTO · ⚠️ DA RIFINIRE
File: `web/public/landing-team.png` (sfondo trasparente, ritaglio `rembg -m
isnet-anime`).
> ⚠️ **TODO**: restano dei **puntini bianchi** (residui di matte) attorno alla
> crocchia dell'Analista e nel gap tra le gambe. Tentati: u2net → camice sporco;
> isnet-anime → meglio ma residui; post-process alpha (soglia 28% + erode 1px) →
> NON risolto. Prossimo tentativo: modello **`birefnet-general`** (matte di
> qualità superiore) oppure ritocco manuale puntuale.

Prompt usato:
> [STYLE] Three Job Hunter Team agents standing, full body, side by side, **on a
> plain transparent background — no scene, no setting**, just the figures. Left to
> right: a **Scout** (sleuth in a trench coat and detective hat, with a magnifying
> glass), an **Analyst** (white lab coat), a **Writer** (smart attire, holding a
> quill pen and writing on a sheet). All standing, none seated. [REGOLA OCCHIALI].
> Leave room for creativity in poses and outfit details. Transparent PNG.

### `landing.dashboard` ✅ FATTO IN CODICE
Realizzato come componente SVG/CSS, **non** immagine generata:
`web/app/components/landing/DashboardMockup.tsx` (donut chart + card flottanti
in prospettiva 3D, sfondo trasparente). Se non convince, qui sotto il prompt di
riserva per generarla invece:
> [STYLE] Over-the-shoulder view of a person at a sleek laptop, the screen showing
> a clean abstract dashboard: a world map dotted with glowing markers, simple bar
> and donut charts, a list of cards — all abstract, NO readable text. Calm,
> modern, premium. The person wears the identical Matrix sunglasses. 16:9.

### `landing.setup` — Mac + cono di luce + cubo col team (sfondo trasparente)
> Comic-book / graphic-novel illustration, hand-drawn inked outlines, flat cel
> shading, muted palette; not 3D, not photorealistic. A modern laptop
> (MacBook-like) seen at a three-quarter angle — plain, blank/abstract screen. A
> soft glowing BLUE cone of light (Tesseract blue, soft — not Marvel-bright)
> **emerges broadly from the computer itself (from around the screen and keyboard,
> diffuse — NOT from a single pinpoint on the screen)** and widens outward. At the
> wide end floats a glass sci-fi cube (Tesseract-style, soft blue glowing edges)
> containing a tiny office/loft with the team of agents at work inside, seen from
> outside like a miniature world. Subtle green accents. **Isolated on a plain
> transparent background — no scene, no setting.** Transparent PNG. 16:9.
>
> **AVOID:** any readable text or words (no "Tesseract", no labels/UI text), any
> logo or emblem (NO Apple logo, NO eagle/shield crest, no brand marks),
> watermarks.
>
> Riferimento stile cubo: `web/public/chronicles/the-box.png` (Tesseract della
> pagina Cronache).

### `landing.pricing`
> [STYLE] An open, airy composition: an open-source padlock/key motif and a few
> floating provider "coins" with subtle green accents, suggesting "the platform is
> free, you only pay the AI provider". Minimal, elegant, no readable text. 16:9.

---

## Pagina `/team` — mini-immagine per ruolo (4:3 consigliato)

Template per ruolo: **un singolo personaggio (o piccola scena) del ruolo, a
fumetto, con gli occhiali Matrix identici, nell'ufficio elegante, con l'attributo
scenico del ruolo.** Niente testo leggibile.

| promptId | scena (oltre a STYLE + REGOLA OCCHIALI) |
|---|---|
| `team.coordinatore` | The Coordinator — elegant composed director/conductor: refined dark structured tailored jacket/suit (quiet authority, **NO naval/captain uniform, NO peaked cap**), mid-gesture as if cueing the team; the one who turns signals into decisions. *(ex `team.capitano` — rebrand Capitano→Coordinatore, vedi BACKLOG `[JHT-RENAME-COORDINATOR]`)* |
| `team.sentinella` | The Sentinel — tall guard in full dress uniform (bearskin hat, red tunic); stern, watching a wall of vital-sign monitors with a red alert light. |
| `team.dottore` | The Doctor — white medical coat, stethoscope; checking on a seated colleague, caring and calm. |
| `team.scout` | The Scout — detective/sleuth: trench coat, deerstalker-ish hat, magnifying glass and notepad; out hunting for clues. |
| `team.analista` | The Analyst — white lab coat, vials/beakers; coolly examining documents at a desk. |
| `team.scorer` | The Scorer — at a wall of screens in a simulator-style chair, judging; focused. |
| `team.scrittore` | The Writer — smart blazer; crafting a tailored document at a desk, pen in hand. |
| `team.critico` | The Critic — judge's robe and wig; reading a CV with a severe, unimpressed expression. |
| `team.mentor` | The Mentor — wise wizard/sage robe; speaking rarely but with weight, hand raised. |
| `team.assistente` | The Assistant — elegant suit and tie (the bridge to the outside world); warm, welcoming, talking to someone off-frame. |

> Nota: gli attributi scenici per ruolo sono presi dalla tabella "cast" in
> `chronicles-canon.md`. Mantenere coerenza con quelle cover.
>
> ⚠️ **Rebrand in corso** Capitano→Coordinatore (BACKLOG `[JHT-RENAME-COORDINATOR]`):
> la pagina è ora `/agents` (non `/team`) e i ruoli **non mostrano più emoji**.

### `team.coordinatore` — il Coordinatore ✅ v1 IN PAGINA · esplorando v2

v1 (abito beige, cravatta verde, gesto cordiale) è già su `/agents`
(`web/public/agents-coordinator.png`). Si esplora una v2 con un **oggetto
rappresentativo** del ruolo — ma **senza dettarlo**: si lascia scegliere al
generatore (l'utente vuole massima creatività, niente spunti pilotati). Prompt:

> Hand-drawn comic-book / graphic-novel illustration — clean inked outlines, flat
> colours, warm muted palette with subtle green accents (classic adventure-comic look).
> Full-figure character on a plain white background, no scene.
>
> **The Coordinator** — the calm, friendly leader who coordinates the whole team. A
> normal, well-dressed person in an elegant outfit, relaxed and confident, wearing the
> same small discreet dark sunglasses as the rest of the team. **Give him some prop or
> object that naturally represents his role of leading and coordinating a team — your
> choice.** Calm, approachable expression, not stern. Elegant, a touch witty; leave the
> creativity to you, don't over-detail.

Note: sfondo bianco/piatto (lo scontorno io con rembg). Niente testo leggibile, loghi,
emoji o riferimenti a file. **Regola generale per tutti i ruoli:** descrivere il
carattere + chiedere "un oggetto/prop che rappresenti il ruolo, a scelta del
generatore", senza imporre quale.

### `team.scout` — gli Scout (2 figure intere) ⬜ DA GENERARE

Lo Scout è un pool → l'immagine ne mostra **più d'uno**. Lo **stile è ok** (investigatori
vittoriani eleganti, palette terrosa+verde, NO boy-scout). Affinamenti utente: **esattamente
2 Scout**, **figura intera** come il Coordinatore, pose precise. Titolo ruolo sulla pagina
→ plurale **"Gli Scout / The Scouts"** (fatto).

⚠️ Ricorda: "Scout/hunters/adventure" fa uscire boy-scout (fazzoletti, borse, safari). Usa
"elegant investigators / detective-story" + blocco Avoid. Prompt:

> Hand-drawn Western graphic-novel illustration (realistic proportions, NOT anime/manhwa),
> clean inked outlines, flat colours, warm earthy palette with green accents, vintage
> detective style. Plain white background.
>
> **Two elegant detective-style investigators (the Scouts), full figure head-to-toe —
> mature adults in their late 30s–40s (NOT teenagers or twenty-somethings).** Left: one
> sitting at a desk working at a computer (legs visible). Right: one standing, examining a
> sheet with a magnifying glass. Both wear identical **small round/oval dark sunglasses,
> thin metal frames, lenses fully hiding the eyes** (no eyes visible — virtual agents).
> Trench coats / waistcoats / pinstripe suits; calm and a touch witty.
>
> Avoid: anime/manhwa youthful faces, teenagers, boy-scout / safari outfits, neckerchiefs,
> large or square glasses, visible eyes, readable text.

> Scontorno: `isnet-general-use` (laptop + foglio da preservare).

---

## Pagina `/pricing`

### `pricing.hero` — testa agente di PROFILO a raggi X, cervello AI (sfondo trasparente)
Concetto: la struttura del team è gratis, **il "cervello" (il provider AI) lo
paghi** → testa di un agente, vista come radiografia, ma dentro il cranio NON c'è
un cervello umano biologico: c'è un **cervello AI = rete neurale / LLM**.

> _Revisione 2026-06-21: il "cervello" è ora una RETE NEURALE / LLM, non un cervello
> umano biologico. Tenere ESATTAMENTE il look dell'immagine attuale: radiografia
> TRASLUCIDA (NON ritratto realistico), completo e faccia solo accennati, teschio
> tenue, cervello protagonista. Modo migliore = editare l'immagine esistente
> sostituendo SOLO il cervello; sotto il prompt completo da zero come fallback._

> **Translucent medical X-ray / radiograph scan** (see-through, blue-teal tones) —
> **NOT a realistic shaded portrait, NOT a photo of a face**. **Side PROFILE of a
> man's head and shoulders, facing RIGHT.** See-through X-ray look: **hair visible**
> as fine translucent strands, small round dark **Matrix-style sunglasses**, and the
> **skull, jaw, teeth and cervical spine only FAINTLY visible** underneath. He wears
> a **suit jacket and shirt collar, but only subtly suggested** at the shoulders —
> **do NOT emphasize the suit or the face**. The clear **focal point is the BRAIN**,
> glowing bright green: it is an **artificial AI brain** in the shape of a brain — a
> **neural network / LLM made of layered columns of bright nodes (input → hidden →
> output) connected by thin lines**, **no biological folds or gyri**. The green AI
> brain glows strongly and dominates; everything else stays dim and translucent.
> No readable text, no logos. **Isolated on a plain transparent background**, no
> scene. Transparent PNG, 4:3.
>
> Edit-only (consigliato, sull'immagine esistente): _Replace only the brain with a
> green AI neural network (layered nodes + connections, no biological folds). Keep
> same shape, position, glow. Change nothing else._

---

## Pagina `/setup`

### `setup.local` — laptop "ThinkPad" (sfondo trasparente)
> Comic-book / graphic-novel illustration, hand-drawn inked outlines, flat cel
> shading, muted palette with subtle green accents; not 3D, not photorealistic.
> A classic boxy matte-black business laptop, open, seen at a three-quarter
> angle — with the iconic small **RED pointing-nub in the middle of the keyboard**
> and a discreet status light (clearly a rugged business notebook, but **WITHOUT
> any brand name or logo**). Isolated on a plain transparent background, no scene.
> Transparent PNG. 4:3.

### `setup.dedicated` — mini-desktop "Mac mini" (sfondo trasparente)
> Comic-book / graphic-novel illustration, same style. A small compact square
> aluminium **mini-desktop** — a low, flat silver box with rounded corners, a
> single round power light on the front and a few ports on the back (Mac-mini
> form factor), sitting on a surface. **NO brand logo** (or a tiny invented
> neutral mark only if unavoidable). Isolated on a plain transparent background,
> no scene. Transparent PNG. 4:3.

### `setup.vps` — server davanti + grande nuvola OneDrive completa (sfondo trasparente)
> Comic-book / graphic-novel illustration, hand-drawn inked outlines, flat cel
> shading, muted palette with subtle green accents; not 3D, not photorealistic.
> A **large, COMPLETE OneDrive-style flat cloud** (clean simple cloud
> SHAPE/outline, NOT a fluffy 3D sky-cloud, NO face) — **fully visible and clearly
> readable as a cloud, big enough to frame the whole scene**. **In front of it, a
> server tower / small rack** (stacked units, tiny green status lights), placed so
> it does NOT cover or hide the cloud's outline — the entire cloud shape stays
> visible all around and behind the server. The server is clear and prominent, the
> cloud is unmistakably a cloud. No readable text, no brand logos. Isolated on a
> plain transparent background, no scene. Transparent PNG. 4:3.

### `setup.app`
> [STYLE] A stylized view of the desktop app window: a big green START button, a
> team-status panel, simple toggles — clean and friendly, abstract UI with NO
> readable text. 4:3.
