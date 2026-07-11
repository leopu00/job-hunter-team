# Sprite agenti — contratto spritesheet (v1, 2026-07-11)

Gli agenti in-world passano dagli SVG a parti (CharacterRig) a **spritesheet
PNG dipinti via Codex** in stile unico pittorico (ricetta Disco Elysium,
coerente con l'ambiente gen-art). Questo file è il contratto tra chi genera
gli sheet (dev1) e chi li anima/chiama (behavior system, dev2).

## File

```
game/assets/characters/sheets/<ruolo>_<variante>.png
```

- `ruolo` ∈ `scout | analista | scorer | scrittore | critico` (i 5 reparti;
  più avanti eventuali `coordinatore`, `assistente`, …).
- `variante` ∈ `a, b, c, …` — stessa silhouette e stile, cambiano capelli,
  carnagione e tinta dell'abito. Fino a 6 agenti per reparto → le varianti
  si riciclano con tinte diverse via `modulate` se servono più di 3.

## Griglia

- Canvas **768×2304**, RGBA trasparente. Griglia **6 colonne × 12 righe**,
  cella **128×192** (l'arte è a 2×: in gioco il rig scala 0.5 → 64×96).
- **Piedi della figura a (64, 180)** di ogni cella (origine del rig ai piedi).
- Vista top-down ¾ da RPG; figura alta ~150-170 px nella cella.
- `side` guarda a **destra**; la sinistra si ottiene con flip orizzontale.

| riga | traccia | frame usati |
|---|---|---|
| 0 | idle_down | 2 |
| 1 | idle_up | 2 |
| 2 | idle_side | 2 |
| 3 | walk_down | 6 |
| 4 | walk_up | 6 |
| 5 | walk_side | 6 |
| 6 | work_down | 4 |
| 7 | work_up | 4 |
| 8 | work_side | 4 |
| 9 | carry_down | 6 |
| 10 | carry_up | 6 |
| 11 | carry_side | 6 |

Celle non usate = completamente trasparenti.

- **idle**: respiro lento (2 frame, micro-shift).
- **walk**: ciclo 6 frame contact→pass→contact, braccia in controfase.
- **work**: in piedi alla postazione, mani avanti che digitano (4 frame).
- **carry**: come walk ma con una risma di fogli bianchi tenuta davanti
  a due mani (per i flussi cross-reparto).

## Animazione (lato rig)

`CharacterRig.set_motion(facing, flipped, mode)` resta la firma pubblica.
`mode` ∈ `idle | walk | work | carry`. FPS: walk/carry 10, work 8, idle 2.

## Qualità (audit obbligatorio su ogni sheet)

1. **Alpha**: media ≥ 250 nella zona certamente opaca del torso (mai il
   matte chroma-key semi-trasparente di Codex — vedi gen-art/LOG.md).
2. **Aggancio piedi**: nei 6 frame di walk i piedi restano nell'intorno
   di (64, 180) ±6 px — niente "scivolamento" verticale tra frame.
3. **Identità**: occhiali tondi scuri SEMPRE (firma degli agenti);
   palette abiti coerente col ruolo; niente pixel art, niente flat vector.
