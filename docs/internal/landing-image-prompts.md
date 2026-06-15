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
> shading, muted palette; not 3D, not photorealistic. A modern Mac (laptop) seen
> at a three-quarter angle. From its screen a soft glowing BLUE cone of light
> (Tesseract blue, soft — NOT Marvel-bright) projects outward: the sharp tip
> touches the screen and the cone widens as it goes out. At the wide end floats a
> glass sci-fi cube (Tesseract-style, soft blue glowing edges) containing a tiny
> office/loft with the team of agents at work inside, seen from outside like a
> miniature world. Subtle green accents. **Isolated on a plain transparent
> background — no scene, no setting.** Transparent PNG. 16:9.
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

### `pricing.hero`
> [STYLE] A confident, generous scene: the team gesturing openly toward the viewer
> as if to say "it's all yours, free" — open-source spirit. Subtle green accents.
> No readable text. 16:9.

---

## Pagina `/setup`

### `setup.local`
> [STYLE] A person at home at a desk with a laptop running the team locally — a
> small Docker-whale motif subtly present. Cozy, private, in control. [REGOLA
> OCCHIALI]. 4:3.

### `setup.dedicated`
> [STYLE] A small always-on mini-PC tucked on a shelf, glowing softly, working
> through the night while the home is quiet. Warm, reassuring. 4:3.

### `setup.vps`
> [STYLE] A clean depiction of a remote cloud server working 24/7 for the user,
> connected by a subtle green line to a laptop where the user checks in. Modern,
> lean. No readable text. 4:3.

### `setup.app`
> [STYLE] A stylized view of the desktop app window: a big green START button, a
> team-status panel, simple toggles — clean and friendly, abstract UI with NO
> readable text. 4:3.
