# Dialogue i18n contract

Ticket: `WIN-DIALOGUES-MONOLINGUAL`

## Census at `f39fee312d`

The authored dialogue surface is not one undifferentiated set of strings:

| Surface | Canonical source | Measured coverage |
| --- | --- | ---: |
| Dialogue-tree narrative | `Dialogues.TREES` | 38 trees, 222 node lines, 138 choice labels (360 strings) |
| Dynamic narrative shells | `Dialogues` | 3 greetings, 4 runtime-location lines, 1 position-summary template (8 strings) |
| Staged-tour UI/narrative bridge | `tour.invite` and `tour.guide.*` in `UIStrings` | 17 keys, already present in all 7 locales |
| Dialogue chrome | `hud.dialogue_*` and role-name keys in `UIStrings` | already localized UI copy |
| User/external data | player name, position title/company/location, score reasons and free text | never translated |

The partial system is therefore real: dialogue chrome and the 17 staged-tour
lines already use `UIStrings`, while `DialogueUI` reads all 360 tree strings
directly and the 8 dynamic shells are English literals.

## Canonical identity and fallback

`Dialogues.TREES` remains the single canonical source for graph structure,
actions, poses, English fallback text and placeholder shape. Translation keys
are derived from semantic graph identity, never from source text or display
order:

- node: `dialogue.<tree_id>.<node_id>.line`
- choice: `dialogue.<tree_id>.<node_id>.choice.<next_id>`
- dynamic shell: `dialogue.dynamic.<semantic_id>`

A node may not contain two choices with the same `next_id`. Changing wording
does not change an ID; changing a branch target is a graph change and therefore
changes the choice ID deliberately.

The language is always `UIStrings.lang`, backed by the shared
`i18n-prefs.json` contract. Narrative translations are sparse overlays: a
missing entry falls back to the canonical English source. We do not copy the
same English string into seven files merely to make key sets look equal.
Every one of the seven supported locales must nevertheless resolve every ID to
non-empty text with the same placeholders as the English source.

## Presentation versus data

- UI copy continues to use ordinary `UIStrings` keys.
- Authored narrative is resolved only at presentation time. Emotion tags are
  part of the localized line; pose, action, `next_id` and tree structure are
  not localized.
- Player/external values inserted into placeholders are data and remain
  byte-for-byte unchanged by translation.
- A dialogue selection is user data only as its canonical branch value
  (`next_id`). Its localized label is presentation and must not enter the
  structured/model context for new records.
- Existing saved answers are not migrated, normalized or destroyed. The
  separation is forward-only and is marked on newly recorded dialogue choices.

## Verifiable delivery boundary

This ticket introduces the resolver, canonical IDs, seven-locale resolution
and placeholder gates for all 368 currently bypassing authored strings. The
17 already-localized staged-tour keys stay in the authoritative UI catalog.
Human translation of 368 strings into each of the six non-English locales is
a separate editorial workload (2,208 locale-string cells) and is not invented
by machine or hidden by duplicated English entries. The census/test reports
that residue precisely while runtime has a deterministic English fallback.
