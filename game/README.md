# Job Hunter Team — The Office

Godot 4.7 desktop application for Windows, macOS and Linux. The three native
presets are versioned in `export_presets.cfg`; CI imports, tests, exports and
smoke-runs the application on a native runner for every operating system.

The first-run experience is documented in [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md):
token-free showroom conversations cover every role. Provider authentication is
a strict boundary: offline authored choices disappear before live free-text
chat starts; real agents may generate contextual reply buttons.

## Development

- macOS/Linux: `tools/run.sh test` and `tools/run.sh play`
- Windows PowerShell: `tools/run.ps1 test` and `tools/run.ps1 play`
- Override the Windows Godot executable with `JHT_GODOT_BIN` when it is not in
  `PATH`.

The live VPS integration requires an OpenSSH client in `PATH`. The UI checks
both OpenSSH and the selected private key before connecting. Windows users can
enable the built-in **OpenSSH Client** optional feature; macOS and normal Linux
desktop installations already provide it.

## Graphics profile

The office adapts to the machine it runs on. Two levers move together, because
neither is enough alone: the **render scale** of the world (drawn in a reduced
`SubViewport`, upscaled with nearest filtering) and the **luxury scenery**
(tesseract edges, hologram, paper piles, day/night cycle, printer smoke — 85 of
822 draw calls, measured with `JHT_CENSUS`). Capping the framerate at 30 was the
original profile and it changed nothing: a machine doing 8fps never touches the
cap.

The performance profile also keeps depth cues and onboarding markers in a
cheaper form: one furniture shadow instead of three, a two-pass static agent
aura, and a two-pass quest diamond without glow. On the reference 16-agent
office this reduced the representative Compatibility-renderer census from 831
to 519 draw calls (−37.5%) while retaining sprites, status labels, speech and
department colors. `JHT_CENSUS=1` also reports the aggregate cost of each agent
subpart so future visual changes cannot hide inside a single `agent_npc` total.

Left alone, the game calibrates itself: it samples the framerate for 10 seconds
after entering the office, drops to the step that matches what it measured, and
keeps watching while you play — it goes further down when the office fills up
and back up when there is headroom again. The last measured scale is remembered,
so the next launch does not replay the first fifteen laggy seconds.

**Settings → Graphics** hands that decision to the user: `Automatic`, `Maximum`,
`Balanced` (world at 85%) or `Performance` (world at 60%, scenery off). An
explicit choice **wins**: neither the calibration nor the continuous watcher
touches the graphics again, because on a slow machine a game that silently
changes its own look every half minute is worse than the lag. Choosing
`Automatic` again wipes the stored measurements and starts a fresh calibration.

Readability is not part of the trade-off. Text living inside the world — status
tags, speech bubbles, agent messages — is marked with `WorldText` and scales
itself up by exactly the inverse of the render scale, so it keeps the same amount
of physical pixels it had at full resolution (`WORLD-TEXT-TEST` measures it).
Interface text never goes through the reduced stage at all.

Concurrent speech is packed at 10 Hz around every visible head and the active
camera bounds. Nearby messages use one horizontal lane per side and then higher
rows, so boxes neither overlap nor cover faces. Every bubble includes the
speaker name; this keeps attribution explicit when a box moves away from its
natural anchor. `JHT_BUBBLE_LAYOUT_TEST=1` stages three long simultaneous
messages and asserts separation, head clearance, camera bounds and labels.

Test hooks, all headless: `JHT_PIXEL=<scale|divisor>` forces a render scale,
`JHT_LOW_GFX=1` forces the reduced profile, `JHT_CENSUS=1` attributes draw calls
branch by branch, and `JHT_GFX_TEST` / `JHT_WORLD_TEXT_TEST` /
`JHT_GRAPHICS_PANEL_TEST` / `JHT_BUBBLE_LAYOUT_TEST` run the visual self-tests.
A profile forced through the environment also freezes the watcher: otherwise
every benchmark converges on the same step the calibration picked.

## Native exports

Install the Godot 4.7 export templates, then run from `game/`:

```text
godot --headless --export-release "Windows Desktop" builds/windows/job-hunter-team.exe
godot --headless --export-release "macOS" builds/macos/job-hunter-team.zip
godot --headless --export-release "Linux" builds/linux/job-hunter-team.x86_64
```

The macOS preset deliberately keeps App Sandbox disabled: the live backend
starts the system OpenSSH client, which sandboxed applications cannot execute.
Tag releases require Apple Developer credentials, then CI signs, notarizes,
staples and verifies the app before publishing it. CI refuses to publish an
unsigned macOS game. Linux releases are wrapped in a `tar.gz` after `chmod +x`,
so extracting the archive preserves the executable bit.
