# The Assistant's portraits

Five painted portraits, one per expression: `portrait-neutro`, `portrait-caldo`, `portrait-divertito`,
`portrait-pensieroso`, `portrait-sorpreso` (`.webp`).

- **Source:** `game/assets/gen-art/portraits/assistente/full_<emotion>.png` (1120x1520 PNG with transparency,
  2.5 MB each), the game's painted portraits of the Assistant. How they were made and approved is in
  `game/assets/gen-art/LOG.md`.
- **What was done to them:** resized to 640 px wide (Lanczos) and converted to WebP with their alpha channel
  (`cwebp -q 80 -alpha_q 90 -m 6`), metadata stripped. Nothing else: no repainting, no cropping.
- **Why:** the five PNGs are 11 MB, too much for the app's bundle; the five WebP are 376 KB.
- **Missing on purpose:** `severo` (the game has it for other roles, not for the Assistant). The app shows the
  neutral face for it.
