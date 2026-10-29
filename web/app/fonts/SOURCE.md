# Fonts of the site

`jetbrains-mono-wght.ttf` is JetBrains Mono, the variable font (weights 100 to 800), 303144 bytes.
It is licensed under the SIL Open Font License 1.1: the text is in `OFL.txt` next to it.

- Source: the JetBrains Mono **2.304** release, <https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip>
  (zip sha256 `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf`), file `fonts/variable/JetBrainsMono[wght].ttf`; `OFL.txt` is the one in the zip (sha256 `30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad`) with the trailing
  spaces of its lines removed (`sed -E 's/[[:space:]]+$//'`, one line was affected) so that the repo's whitespace check passes; nothing else changed.
- sha256 of the font file: `662a196d58f1183bf2d77428b6d5283fe3f45161ab021bea4036bc98e5cac016`
- Used by `web/app/layout.tsx` through `next/font/local`, so that building the site does not need the network
  (`next/font/google` downloads the font from Google when it builds). `tests/test_web_font_is_local.py` keeps both true.
- sha256 of `OFL.txt` as it is here (every line without trailing spaces, which is also what the zip's text gives that way): `60d55f23c6ce05a81099a762cb67ca2c9b6ea251c7912720998b4c89ebfd4faa`
