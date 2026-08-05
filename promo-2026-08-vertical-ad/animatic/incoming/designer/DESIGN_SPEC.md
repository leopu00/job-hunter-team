# JHT vertical animatic overlay pack

Production canvas: **1080×1920 RGBA**. All live copy stays inside
`x=108..972`, `y=220..1580`; `99_safe_area_reference_DO_NOT_COMPOSITE` is a
guide only.

## Typography and color

- JetBrains Mono from `game/assets/fonts/`: ExtraBold for hooks/actions, Bold
  for CTA/support, Medium only for secondary CTA copy.
- Minimum delivered type size: **58 px** at 1080×1920, equivalent to 19.3 px
  on a 360×640 phone. Hook is 72–78 px; actions are 144 px.
- Brand source tokens: site/game `#00E87A` green, `#060608` void,
  `#F0F0FA` white, `#B8B8D0` base. Green is limited to the slim alignment bar
  (and the short CTA divider), never used as a text flood.
- Caption bands use `#060608` at 76% opacity; the larger end card uses 80%.

This follows the current JHT UI language: squared mono typography, near-black
surfaces, thin green state accents and no decorative effects. Compared with
the older vertical promo, the copy is materially larger and the caption band
is locked low so the center/upper character field remains uncovered.

## Motion recipe (30 fps reference)

- Hook: 4 frames / 133 ms, opacity 0→100%, Y +14→0 px,
  `easeOutCubic`; it is fully readable before the 0.2 s gate.
- All other entries: 5 frames / 167 ms, opacity 0→100%, Y +18→0 px,
  `easeOutCubic`.
- Exit: 4 frames / 133 ms, opacity 100→0%, Y 0→−8 px, `easeInQuad`.
- Verbs may use a straight cut or a 3-frame opacity dissolve. No zoom, bounce,
  glow, glitch, chromatic split or kinetic per-letter animation.
- End card begins at **15.8 s** and holds to 20.0 s. Enter over 8 frames; keep
  `jobhunterteam.ai` continuously readable after the entry.

The exact machine-readable version is in `manifest.json`.

## Editorial use

- PNG is the exact raster render with the bundled font.
- SVG is the editable source; load JetBrains Mono before export.
- Every numbered content overlay already includes the persistent preview
  watermark. If the editor uses one global watermark layer, use
  `00_watermark` and do not stack a second copy.
- The lower caption band is deliberate: do not move titles above the actors'
  shoulders. If a shot has important action in the lower quarter, crop/reframe
  that shot rather than placing the title over a face.
