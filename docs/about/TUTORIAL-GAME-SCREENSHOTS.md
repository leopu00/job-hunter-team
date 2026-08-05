# Tutorial game screenshots

This record is the persistent provenance and privacy attestation for the game
frames published in the text tutorial. It intentionally records the public
asset path, reproducible capture context, and SHA-256 checksum rather than an
operator's local path.

| Public asset                          | Source scene                                                    | Capture context                                                                                       | SHA-256                                                            |
| ------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/tutorials/game/office-overview.png` | Native office, open-day frame at the four-second selftest delay | `game@8e813159f`; synthetic harness `JHT_NOVPS=1`, `JHT_LANG=en`, `JHT_HOUR=10`, `JHT_PROMO=open-day` | `78ee14b453ffc2298c1653136dbbd4b0972576fe7235abecd824b8cbea4561c0` |
| `/tutorials/game/departments.png`     | Writers department, one second before the vignette              | `game@477d4492d`; synthetic harness `JHT_NOVPS=1`, `JHT_LANG=en`, `JHT_HOUR=10`                       | `03e8a20e8c6303e1952e265cbe4b40300829c823715cf4ce552aed3f0e547867` |

## Publication safety

Both files are 1600 by 900 PNGs in sRGB. Their source harness is synthetic;
the captured product surface is English-only and contains no personal data,
HUD, sidebar, or demo controls. EXIF, XMP, and IPTC metadata are absent.

The office frame was captured after the desk-front occlusion correction and
its `FURNITURE-OCCLUSION`, `PROMO-SIGN-LAYER`, and supported agent-route
selftests passed. The departments frame passed the promo-sign-layer gate.

If either public image is replaced, update this record and its checksum in the
same change. The tutorial-content test also pins these files to game steps one
and two, so a later reordering cannot silently detach their explanatory text.
