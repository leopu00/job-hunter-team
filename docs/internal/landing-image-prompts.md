# 🎨 Prompt immagini — Sito pubblico

Raccolta dei prompt per **tutte le immagini** del sito pubblico (landing + pagine
dedicate). Ogni placeholder nel codice porta un `promptId` che corrisponde a una
voce qui sotto. Stile e regole condivise vivono in
[`chronicles-canon.md`](./chronicles-canon.md) (sezione "Stile visivo" + regola
**occhiali da sole** Matrix identici per tutti).

Convenzione `promptId`: `area.nome` (es. `team.analisti`, `hero.main`).

---

## 🔁 Blocco STYLE condiviso (copiare in testa a ogni prompt)

> Hand-drawn comic-book / graphic-novel illustration — bold inked black outlines,
> flat cel shading, limited muted palette with subtle green accents, light
> halftone / paper-grain texture; not 3D, not photorealistic, not a glossy AI
> painting. Elegant, a touch witty.

**Regola occhiali (sempre):** ogni agente indossa gli **stessi identici** occhiali
da sole — piccole lenti ovali scure con montatura sottile in metallo, stile
Agente di Matrix (ref. `prima-release/reference-images/00-agent-base.png`).

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
| `team.capitano` | The Captain — navy double-breasted pilot jacket, gold buttons and epaulettes, peaked cap with a winged badge; standing, coordinating the room. |
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

---

## Pagina `/pricing`

### `pricing.hero` — testa agente di PROFILO a raggi X, cervello AI (sfondo trasparente)
Concetto: la struttura del team è gratis, **il "cervello" (il provider AI) lo
paghi** → testa di un agente, vista come radiografia, ma dentro il cranio NON c'è
un cervello umano biologico: c'è un **cervello AI = rete neurale / LLM**.

> _Revisione 2026-06-21: il "cervello" è ora una RETE NEURALE / LLM, non un cervello
> umano biologico. Tenere le qualità dell'immagine attuale: radiografia "morbida"
> con CAPELLI + GIACCA e CRAVATTA, teschio TENUE, cervello protagonista._

> Photorealistic **medical X-ray / radiograph** look (a soft see-through scan, like
> a real radiograph — **NOT a bare skeleton, NOT a comic drawing**). **Side PROFILE
> of an agent's head and shoulders, facing RIGHT** (we do NOT see the face
> front-on). The figure clearly has **styled HAIR on the head** (soft translucent
> layer) and wears a **business SUIT JACKET with a shirt collar and a TIE** at the
> neck/shoulders — a well-dressed agent. **Soft-tissue translucency** so we read a
> real person's profile (face silhouette, ear, neck); the **skull bones are only
> FAINTLY visible underneath — keep the skull SUBTLE, do NOT emphasize bare
> teeth/jaw**. Inside the head, the **BRAIN is the bright focal point** and is an
> **ARTIFICIAL / AI BRAIN**: a glowing green **NEURAL NETWORK in the shape of a
> brain** — a **layered deep-network structure (input / hidden / output columns of
> nodes)** with bright interconnected nodes and links, like an **LLM / deep neural
> net** (**NO biological gyri or brain folds**). The neural-network brain **glows
> strongly in green and dominates the composition**; the rest of the head/skull
> stays in cooler, dimmer X-ray tones so the emphasis is on the BRAIN, not the
> skull. Small oval dark **Matrix-style sunglasses** on the face. Cool blue-teal
> X-ray palette for the body, vivid green glow for the AI brain. No readable text,
> no logos. Isolated on a plain transparent background, no scene. Transparent PNG.
> 4:3.

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
