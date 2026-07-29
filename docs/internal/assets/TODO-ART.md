# TODO arte — cosa manca da disegnare

**Aggiornato**: 2026-07-29 · **Destinatario**: chi genera gli asset (pipeline `gen-art`)
**Registro storico**: [`game/assets/gen-art/LOG.md`](../../../game/assets/gen-art/LOG.md)

Due lotti, in ordine di priorità. Il primo chiude un'informazione che oggi
manca all'utente; il secondo una promessa che il gioco fa e non mantiene.

Formato per tutti: **PNG 1120×1520 con alpha**, come i quattordici consegnati
il 2026-07-22. Ogni volto va **derivato dalla sua ancora** — non ridisegnato da
zero — per conservare identità, abiti, crop e proporzioni.

---

## Lotto 1 — Sei `pensieroso` mancanti · priorità ALTA

**Completato su `dev6` il 2026-07-29**: i sei PNG sono stati derivati dalle
rispettive ancore, normalizzati a 1120×1520 RGBA e verificati anche su fondo
scuro. Il Lotto 2 resta aperto.

### Perché serve

La chat a fumetti mostra il ritratto dell'agente accanto alle vignette e passa a
`pensieroso` **mentre l'agente sta scrivendo la risposta**. I sei ruoli qui sotto
non hanno quella posa e ricadono in silenzio su `neutro`: l'attesa diventa
indistinguibile dalla risposta già arrivata, che è esattamente l'informazione che
quella posa doveva dare.

### Cosa produrre

`game/assets/gen-art/portraits/<slug>/full_pensieroso.png`

| # | slug | ancora da cui derivare | espressioni già presenti |
|---|---|---|---|
| 1 | `assistente` | `full_neutro.png` | caldo, divertito, neutro, sorpreso |
| 2 | `coordinatore` | `full_neutro.png` | caldo, neutro, severo |
| 3 | `critico` | `full_neutro.png` | caldo, divertito, neutro, severo |
| 4 | `scrittore` | `full_neutro.png` | caldo, neutro |
| 5 | `sentinella` | `full_neutro.png` | caldo, neutro, severo |
| 6 | `mantenitore` | `full_neutro.png` | caldo, neutro |

**Riferimento della posa**, per chi ce l'ha già: `scout`, `analista`, `scorer`,
`dottore`, `mentor`.

---

## Lotto 2 — I volti per istanza · priorità MEDIA

**In corso su `dev6` dal 2026-07-29**: completate e importate le due emozioni
operative (`neutro`, `pensieroso`) per le istanze 1–2 di tutti e cinque i
reparti, 20 PNG in totale. Le varianti `a` riusano intenzionalmente il ritratto
del ruolo, perché sono la stessa identità; le varianti `b` sono state derivate
dai rispettivi sprite. Restano le istanze 3–6.

### Perché serve, e cosa NON è

Non sono facce nuove. **In ufficio ogni agente ha già il suo volto**, assegnato
per scrivania (`CharacterDefs.VARIANT_BY_DESK`) con sprite reali in
`game/assets/characters/sheets/<ruolo>_<lettera>.png` — tutte e 30 esistono.

**In chat, invece, si vede il ritratto del ruolo** (`portrait_view.gd:39` carica
`gen-art/portraits/<slug>/full_neutro.png`): parlare con `scout-1`, `scout-2` o
`scout-5` mostra sempre la stessa faccia, mentre in sala sono tre persone
diverse. Dalla 0.3.2 hanno anche cognomi diversi, quindi Holmes e Colombo si
presentano con lo stesso volto.

Serve quindi ritrarre **le varianti che già esistono**, derivando ciascun volto
dal proprio sprite.

### Dove vanno

`game/assets/gen-art/portraits/<ruolo>-<n>/full_<emozione>.png`

Il codice **non va toccato**: `ComicChat.portrait_slug()` cerca già quella
cartella prima di ripiegare sul ruolo. Depositare i file è sufficiente.

### La mappa esatta

⚠️ **La variante non segue il numero.** Il lead di ogni reparto è la `a`, e non
siede al primo banco in tutti i reparti: per Scout, Analisti, Scorer e Scrittori
il lead è il **numero 2**, per i Critici è il **numero 1**. La tabella è già
risolta, non ricalcolarla.

#### scout

| agente | variante | sprite di riferimento | cognome |
|---|---|---|---|
| `scout-1` | **b** | `scout_b.png` | Holmes |
| `scout-2` | **a** | `scout_a.png` | Colombo |
| `scout-3` | **c** | `scout_c.png` | Poirot |
| `scout-4` | **d** | `scout_d.png` | Marple |
| `scout-5` | **e** | `scout_e.png` | Montalbano |
| `scout-6` | **f** | `scout_f.png` | Dupin |

#### analista

| agente | variante | sprite di riferimento | cognome |
|---|---|---|---|
| `analista-1` | **b** | `analista_b.png` | Einstein |
| `analista-2` | **a** | `analista_a.png` | Newton |
| `analista-3` | **c** | `analista_c.png` | Curie |
| `analista-4` | **d** | `analista_d.png` | Galilei |
| `analista-5` | **e** | `analista_e.png` | Darwin |
| `analista-6` | **f** | `analista_f.png` | Fermi |

#### scorer

| agente | variante | sprite di riferimento | cognome |
|---|---|---|---|
| `scorer-1` | **b** | `scorer_b.png` | Ronaldo |
| `scorer-2` | **a** | `scorer_a.png` | Sinner |
| `scorer-3` | **c** | `scorer_c.png` | Ellison |
| `scorer-4` | **d** | `scorer_d.png` | Jordan |
| `scorer-5` | **e** | `scorer_e.png` | Gretzky |
| `scorer-6` | **f** | `scorer_f.png` | Piola |

#### scrittore

| agente | variante | sprite di riferimento | cognome |
|---|---|---|---|
| `scrittore-1` | **b** | `scrittore_b.png` | Calvino |
| `scrittore-2` | **a** | `scrittore_a.png` | Hemingway |
| `scrittore-3` | **c** | `scrittore_c.png` | Austen |
| `scrittore-4` | **d** | `scrittore_d.png` | Orwell |
| `scrittore-5` | **e** | `scrittore_e.png` | Borges |
| `scrittore-6` | **f** | `scrittore_f.png` | Woolf |

#### critico

| agente | variante | sprite di riferimento | cognome |
|---|---|---|---|
| `critico-1` | **a** | `critico_a.png` | Ebert |
| `critico-2` | **b** | `critico_b.png` | Kael |
| `critico-3` | **c** | `critico_c.png` | Ruskin |
| `critico-4` | **d** | `critico_d.png` | Croce |
| `critico-5` | **e** | `critico_e.png` | Vasari |
| `critico-6` | **f** | `critico_f.png` | Bloom |

### Quante emozioni per istanza

Trenta agenti × ogni emozione è tanto, e non tutto serve subito. Ordine
suggerito, da fermare quando basta:

1. **`neutro`** per tutti e 30 — è il volto che si vede sempre;
2. **`pensieroso`** per tutti e 30 — è l'attesa, cioè il lotto 1 applicato alle istanze;
3. il resto (`caldo`, `severo`, `divertito`, `sorpreso`) **solo se e quando serve**:
   oggi la chat non li usa.

⚠️ **Vale la pena partire dai numeri bassi.** Un team reale ha spesso uno o due
agenti per reparto: `<ruolo>-1` e `<ruolo>-2` coprono la maggior parte delle
sessioni vere, e le sedie 3-6 esistono solo quando il Capitano scala. Coprire
prima quelle otto istanze (2 × 4 reparti + critico-1) dà quasi tutto il valore
con un quarto del lavoro.

---

## Come si verifica che siano arrivati

Nessun passo di build: Godot importa i PNG al primo avvio. Per vedere un
ritratto in chat senza lanciare il gioco a mano:

```bash
bash game/tools/run.sh shot /tmp/chat.png JHT_COMIC_CHAT=scout JHT_NOVPS=1 JHT_SHOT_DELAY=8
```

Un volto mancante non rompe nulla e non lascia traccia a schermo: il ripiego è
silenzioso, ed è il motivo per cui questi sei buchi sono rimasti invisibili fino
al 29/07.
