# Social brand assets

These glyphs identify links to Job Hunter Team's own profiles. Their presence
does not imply endorsement or a partnership.

## What is served today

| File | Source | Licence |
| --- | --- | --- |
| `instagram-glyph.svg` | [Simple Icons](https://simpleicons.org) — `simple-icons/icons/instagram.svg` | CC0 1.0 (public domain) |
| `tiktok-glyph.svg` | [Simple Icons](https://simpleicons.org) — `simple-icons/icons/tiktok.svg` | CC0 1.0 (public domain) |

Both carry no fixed colour, so a single file per network follows the theme
through `currentColor`: white on the dark theme, near-black on the light one.

`FooterSocialLinks.tsx` draws the path **inline** rather than through an
`<img src>`. This is not a style preference: an SVG loaded as an image is an
isolated document and does not inherit `currentColor` from the page. Measured
with Playwright on this very file — as `<img>` the glyph renders black
(`0,0,0`) on a dark background, inline it renders white (`255,255,255`). The
files here stay the source of truth, and a test asserts the inline paths are
still identical to them.

## Why not the vendors' official packs

Until 2026-08-10 the footer served Meta's official `Instagram_Glyph_White.svg`
on a black surface, because a fixed white glyph needs a dark backing to stay
legible on a light theme. Removing that surface required an official black
variant for the light theme.

- **Instagram**: the black variant exists. `IG_brand_asset_pack_2023.zip`
  (SHA-256 `a9e5cbe63dc01279b3d12d536ea9d94ab5236521601bd5cc4b4caf7ba7060e82`)
  ships `01 Static Glyph/03 Black Glyph/Instagram_Glyph_Black.svg`.
- **TikTok**: it does not. The official Dev Portal logo pack (SHA-256
  `b3f31728ceb6ce6fc1a0ae8c635a0223e35ac2f7d203b2743e713541bf2085cd`) carries
  the square icon **in black only** — `TikTok_Icon_Black.ai`,
  `_Black_Square.png`, `_Black_Circle.png`, and none of them in SVG. A white
  version exists only for the extended horizontal/stacked lockup, which is a
  different mark, not a glyph that can sit next to an 18px Instagram icon.

So the dark theme — the site's default — had no official TikTok icon. Rather
than tint a third party's trademark, which their guidelines forbid, the
operator decided on 2026-08-10 to use public-domain monochrome glyphs for both
networks. That is what this folder now holds.

## TikTok is served locally on purpose

The glyph used to be hotlinked from `lf16-tiktok-common.ttwstatic.com`. While
the profile was unpublished nothing requested it, but publishing the link
would have made every visitor to the site visible to TikTok without clicking
anything — on a product that promises your data stays yours. The glyph and the
published flag were therefore switched together, and a test asserts no
external host is referenced.
