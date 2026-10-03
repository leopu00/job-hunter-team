# JHT onboarding illustration prompts

These seven assets were generated with the OpenAI built-in image-generation
tool. No CLI/API fallback or API key was used. Existing JHT artwork was supplied
only as visual reference; the generated compositions are new.

## Reference language

- `web/public/landing-setup.png`: computer-to-office metaphor, cyan glass.
- `web/public/run-local.png`, `run-vps.png`, `run-dedicated.png`: isolated
  product perspective, dark ink contours and transparent canvas.
- `web/public/landing-team.png`, `agents-assistant.png`, `the-box.png`: agent
  linework, office materials and the established Assistant role.

The shared direction was: premium semi-realistic 3D editorial illustration,
three-quarter/isometric perspective, crisp hand-inked edges, graphite and
smoked glass, subtle line-hatched texture, cyan-blue inner light and restrained
emerald operational accents. Every prompt prohibited text, logos, provider
marks, readable screens, account data and watermarks, and requested genuine
alpha transparency.

## Common final prompt

The subject blocks below were appended to this shared prompt, except for the
environment concept whose complete prompt is recorded separately.

```text
Use case: stylized-concept
Asset type: reusable 4:3 onboarding setup-card illustration for the Job Hunter Team desktop app
Input images: recent approved onboarding illustrations and repository visuals are style references only, not edit targets. Match the established family's three-quarter/isometric perspective, premium semi-realistic 3D editorial rendering, crisp hand-inked edges, graphite and smoked glass, subtle line-hatched texture, cool cyan-blue inner light, restrained emerald operational accents, and mature calm mood.
Scene/backdrop: genuinely transparent background; isolated cutout only; no rectangle, floor card, full-frame gradient or scenery.
Composition/framing: exact 4:3 composition intended for a 1600x1200 source; every meaningful subject inside the central 70%; at least 12% transparent empty space left/right and 10% top/bottom; readable at 560x420 CSS pixels; strong simple silhouette.
Lighting/palette: charcoal #16161d, graphite #30303d, cool blue #68adff, pale cyan, restrained emerald #31dd8a, soft off-white highlights; neutral dark shadows plus pale rim light for legibility on both near-black and white UI themes.
Constraints: no text, letters, numbers, UI labels, logos, provider marks, trademarks, IP addresses, hostnames, readable screens, private data or watermark. Genuine alpha transparency with clean edges and no matte halo. No neon-green wash, purple palette, glossy toy look, random symbols or dense micro-detail.
```

### `identity.webp`

```text
Primary request: identity entry shared by Google and local-account paths,
completely brand-neutral. Show a single elegant smoked-glass identity portal in
the center, shaped like an open secure doorway. Two equal visual paths converge
into it: one from a small browser-like glass pane with an abstract anonymous
user silhouette and one from a tactile local metal identity token/key held by
a compact computer pedestal. A soft cyan handshake arc joins both paths inside
the portal, with one tiny emerald verified light. The image should communicate
“choose how to identify yourself, both lead safely into the same app,” without
depicting a success screen.
Avoid: Google colors, cloud-brand motifs, email envelopes, social-login buttons,
fingerprints, faces, readable cards, padlock clichés dominating the scene.
```

### `environment.webp`

```text
Use case: stylized-concept
Asset type: reusable onboarding setup-card illustration, first concept for the Job Hunter Team desktop app
Input images: the repository images are style references only, not edit targets. Derive their visual language—three-quarter/isometric product perspective, crisp dark ink contours, graphite and smoked-glass materials, subtle editorial texture, cool cyan-blue light, very restrained emerald status accents—without duplicating their exact objects or composition.
Primary request: depict the choice of execution environment as one balanced, instantly readable scene. Show a modern dark graphite laptop/computer on one side with a tiny luminous multi-level office visibly living inside its screen/body, and a compact vendor-neutral VPS server cabinet on the other side with a smaller glass office core glowing inside. Connect the two alternatives with one subtle cyan light path, suggesting the same team can live locally or remotely. Both options must feel equally credible, not like one succeeds and one fails.
Scene/backdrop: genuinely transparent background; isolated cutout only, no rectangle, no floor card, no full-frame gradient.
Style/medium: premium semi-realistic 3D editorial illustration with hand-inked edge accents, matching the reference family; clean and mature, not cartoonish, not photorealistic product advertising.
Composition/framing: exact 4:3 composition intended for a 1600x1200 source; all meaningful subjects and action inside the central 70%; at least 12% clear space on left and right and 10% clear space top and bottom; readable at 560x420 CSS pixels; mild three-quarter view; strong silhouette.
Lighting/mood: calm setup confidence; cool cyan rim light and soft blue inner-office glow; small emerald operational lights; neutral dark shadows with pale edge highlights so the cutout remains legible on both near-black and white UI themes.
Color palette: charcoal #16161d, graphite #30303d, cool blue #68adff, pale cyan, restrained emerald #31dd8a, soft off-white highlights.
Materials/textures: brushed dark metal, smoked glass, matte computer shell, subtle line-hatched texture inherited from references.
Constraints: no text, no letters, no numbers, no UI labels, no logos, no provider marks, no trademarks, no IP addresses, no hostnames, no readable screens, no private data, no watermark. Keep tiny office occupants abstract and anonymous. Preserve genuine alpha transparency with clean edges and no dark matte halo.
Avoid: generic cloud-outline icon, bright neon-green wash, purple palette, glossy toy look, floating random symbols, dense micro-detail, background scenery.
```

The chosen concept then received one built-in framing-only edit:

```text
Change only the framing and safe area. Uniformly scale the complete laptop +
cyan connection + VPS composition down and center it on the same genuinely
transparent 4:3 canvas. Preserve exact relative positions, perspective,
silhouettes, office interiors, lighting, palette, linework, materials and all
object details. Ensure at least 12% completely transparent empty space on both
left and right and at least 10% above and below. Do not add a background,
floor, shadow plate or frame.
```

### `provider.webp`

```text
Primary request: vendor-neutral provider selection. Show a dark graphite
selection dock in three-quarter view holding three equal removable AI compute
cores under a shared smoked-glass canopy. The three cores must be intentionally
identical in status and visual importance, differentiated only by subtle
geometry—not color, letters, logos or invented emblems. Cool cyan energy runs
from all three toward one central team-office socket; none is selected yet. A
few tiny emerald readiness lights may appear on the neutral dock.
Avoid: robot brains, company colors, provider logos, alphabetical shapes,
recognizable brand iconography, pricing/payment symbols, winner/loser hierarchy.
```

### `provider-auth.webp`

```text
Primary request: official provider authentication shared across all providers.
Show an unbranded browser-like glass portal on one side and a secure graphite
credential vault on the other, exchanging a single clean cyan light ribbon
through a central verification ring. Include an anonymous device silhouette
and one small emerald confirmation light, but no readable interface, code,
token or credential. The scene must communicate a user-authorized login handoff
to an external provider, secure and pending/active rather than already finished.
Avoid: password fields, OAuth/provider logos, QR codes, digits, text, email
icons, giant padlock, surveillance/fingerprint imagery, warning/error mood.
```

### `runtime.webp`

```text
Primary request: preparation of the runtime, container and artifact integrity
fingerprint. Show a compact graphite technical workbench with three clearly
sequential but label-free stages: a sealed installation capsule entering a
scanning ring; a transparent cyan-edged container cube being assembled from
clean layers; and an abstract integrity fingerprint made of concentric
luminous contour lines resolving into one small emerald verified light. Use a
single flowing cyan path to connect the stages. This is a calm preparation
process in progress, not a finished team and not a biometric identity check.
Avoid: human fingerprint or hand imagery, Docker/Podman logos, terminal text,
barcodes, hashes, warning symbols, gears everywhere, open office or agents.
```

### `team-start.webp`

```text
Primary request: starting the team. Show a dark graphite container base opening
upward into a compact two-level smoked-glass office. Several anonymous
professional agents in restrained dark attire are entering along one cyan-lit
path while desks and ceiling lamps illuminate in sequence; a few small emerald
status lights come alive from bottom to top. The scene should feel like
coordinated startup and orchestration in progress, not a party and not a
completed static office.
Avoid: military imagery, robots, identical clones, superhero poses, provider
logos, text on monitors, confetti, warning/error mood, giant power-button icon.
```

### `assistant-ready.webp`

```text
Primary request: Assistant handoff and ready state. Depict one warm, confident
professional Assistant inspired by the existing JHT Assistant's mature
editorial character language—but not copied exactly—standing beside the
now-ready compact glass office. She holds a dark tablet with a blank screen and
offers an open welcoming hand toward a single empty smoked-glass conversation
bubble/portal. Behind her, the office is softly lit and one complete emerald
readiness ring glows at its base. The scene must communicate “the verified team
is ready; continue with the Assistant into free conversation.”
Character: adult woman, elegant practical brown/charcoal suit, natural
welcoming expression, subtle dark glasses consistent with the JHT agent family;
full figure or three-quarter figure, anonymous and non-photorealistic.
Avoid: text or dots inside the conversation bubble, chatbot robot, magical
fairy, provider branding, celebration confetti, giant checkmark, phone UI,
exaggerated smile or sales pose.
```

## Output normalization

Built-in PNG outputs were kept untouched in the tool's generated-image store.
Selected outputs were trimmed to their alpha bounds, fitted inside a 1120×840
box, centered on a 1600×1200 transparent canvas and encoded as sRGB WebP at
quality 82. This mechanical pass guarantees the shared safe area without
redrawing or compositing new content.

## Feedback candidates v2 — 2026-10-03

The original seven assets above remain unchanged. These three versioned
candidates were created with the built-in image-generation tool after operator
review; no CLI/API fallback or API key was used.

### `environment-computer-v2.webp`

```text
Use case: stylized-concept
Asset type: 4:3 onboarding setup-card illustration for the desktop app.
Input images: landing-setup.png is the primary concept reference;
environment.webp is a family-style reference only.
Primary request: show the local-computer environment as one unmistakable scene:
an unbranded dark graphite laptop in three-quarter view projects a broad soft
cyan beam from the computer itself into a separate luminous glass cube. Inside
the cube is a warm two-level office with tiny anonymous professional agents at
work, echoing the Home “computer to office” metaphor.
Composition: complete action inside the central 70%, with 12% clear at the
sides and 10% above/below, readable at 560x420.
Constraints: genuine transparent background; no text, logos, trademarks,
readable screens, hostnames, private data or watermark.
```

### `environment-vps-v2.webp`

```text
Use case: stylized-concept
Asset type: 4:3 onboarding setup-card illustration for the desktop app.
Input images: landing-setup.png supplies the projected-office metaphor;
run-vps.png supplies the vendor-neutral server language; environment.webp is a
family-style reference only.
Primary request: create the VPS counterpart to the local scene. A compact
unbranded graphite server cabinet projects the same broad cyan beam from its
lit core into a luminous glass cube containing the warm two-level team office.
Match the local counterpart’s perspective, weight and palette.
Composition: complete action inside the central 70%, with 12% clear at the
sides and 10% above/below, readable at 560x420.
Constraints: genuine transparent background; no text, cloud/provider marks,
logos, IP addresses, hostnames, private data or watermark.
```

### `provider-v2.webp`

```text
Use case: stylized-concept followed by one precise-object edit.
Asset type: 4:3 onboarding provider-choice illustration for the desktop app.
Input images: pricing-brain.png is the primary concept reference; provider.webp
is a family-material reference only.
Primary request: reinterpret the Pricing-page translucent blue-teal profile and
bright artificial neural network. Three equal cyan stems rise from the network
into three equal blank smoked-glass medallion mounts. Preserve equal visual
weight and reserve clean space inside each mount.
Constraints for generation: mounts completely blank; no text, letters, logos,
provider marks, invented emblems, interface or watermark; transparent canvas.
Precise edit: remove only accidental horizontal colored line artifacts outside
the profile and restore genuine transparency, preserving everything else.
```

Provider marks were not generated. After operator review, the blank medallions
were filled deterministically from official vectors, preserving their geometry
and proportions: Claude's orange asterisk path from the inline wordmark SVG at
`claude.com`; OpenAI's white Blossom path extracted unchanged from page 13 of
the official “How OpenAI uses Codex” PDF; and `Logomark_Light.svg` from Kimi's
official Brand Book download. This keeps the generated JHT scene focused on the
provider-as-brain metaphor while each choice uses its recognizable product
mark. Source URLs, asset names and SHA-256 checksums are recorded in
`manifest.json`. Image generation was never asked to draw, spell or
approximate a provider mark.

All three candidates were normalized to a 1600×1200 sRGB WebP with alpha. Their
content is fitted inside a 1120×840 safe box. Provider alpha was premultiplied
before resampling to prevent transparent RGB artifacts from bleeding into the
light and dark previews.
