# JHT 30-second demo — storyboard + recording script

Linked from [`BACKLOG.md`](../../BACKLOG.md) item **[JHT-LAUNCH-03]** (blocker
for the launch). The recording itself isn't checked in here — this file is
the shot list, the asciinema script that drives it, and the embed plan for
the README and the Show HN post.

Recording owner: maintainer (only person with the live `jht` install + the demo
SQLite snapshot). Reviewer: anyone on the team who's seen the dashboard run.

## Why 30 seconds, not 90

People who land on `README.md` decide whether to scroll within 5-7 seconds.
A 30-second clip is the longest we can ask them to commit to before they've
seen anything useful. The constraint forces the demo to show *outcome*
(applications ready in `~/.jht/applications/`) rather than the boot
sequence, the OAuth flow, or any UI we're proud of but the user doesn't
need to see yet.

## Format

Two artefacts to produce:

1. **`assets/demo.cast`** — asciinema recording, raw. Source of truth.
   Anyone with `asciinema play` can replay it; the GIF and MP4 are
   derived from it.
2. **`assets/demo.gif`** — auto-converted via `agg` (asciinema gif
   generator). This is what embeds in the README and the HN post.
   Target ≤ 2.5 MB so GitHub renders it inline without a "Show more"
   click. If we overshoot, drop the framerate from 15 to 10 fps.

(An MP4 is optional. GitHub renders MP4 inline now, but the GIF carries
better to other surfaces — Reddit, Mastodon, the press kit deck.)

## Shot list — 30 seconds, 6 beats

| # | Beat | Duration | What's on screen | Caption (asciinema marker) |
|---|------|----------|------------------|---------------------------|
| 1 | Setup | 4s | `jht status` — empty team, no positions | `00:00 — fresh install` |
| 2 | Spawn | 5s | `jht team start` → captain + 1 scout boot, agent panes scroll | `00:04 — team starts` |
| 3 | Discover | 6s | Scout pane: "found 7 new positions" rolling, dashboard tile flips from 0 → 7 | `00:09 — Scout finds positions` |
| 4 | Pipeline | 8s | Time-lapse cut: dashboard counter ticks through Analyst → Scorer → Writer, log tail showing 1-line summaries | `00:15 — analysed → scored → written` |
| 5 | Result | 5s | `ls ~/.jht/applications/` shows 3 tailored CV PDFs + cover letters, open one in the file viewer for a half-second | `00:23 — 3 applications ready` |
| 6 | Outro | 2s | Static frame: repo URL + "github.com/leopu00/job-hunter-team" | `00:28 — github.com/leopu00/job-hunter-team` |

**Total: 30s.** If a beat overruns, cut beat 2 (the spawn) — that's the
most compressible without losing the story.

## Asciinema recording script

Copy-paste-able. Assumes a clean container, a pre-seeded profile, and a
fixed JD list so the Scout always returns the same 7 results (we want
the demo to be deterministic; surprise findings on take 7 of a recording
session is a special kind of pain).

```bash
# Pre-flight (NOT recorded — do this once before pressing record)
jht setup --demo-profile      # loads docs/launch/demo-profile.yml
jht team stop || true         # idempotent
rm -rf ~/.jht/applications/*  # clean output dir

# Recording — 30 seconds, idle-time clamped via -i
asciinema rec assets/demo.cast \
  --title "Job Hunter Team — 30s demo" \
  --command "bash docs/launch/demo-script.sh" \
  --idle-time-limit 1.0       # collapse any pause >1s

# Convert to GIF — agg defaults are noisy, force a smaller theme
agg --theme monokai \
    --font-size 14 \
    --speed 1.0 \
    assets/demo.cast assets/demo.gif

# Sanity-check size
ls -lh assets/demo.gif        # MUST be < 2.5 MB
```

The runnable script `demo-script.sh` lives next to this file and is what
asciinema records. It's intentionally bare — no banners, no `echo --- step
N ---`, no sleep beyond what the agents naturally do. The captions in the
shot list are added in post via asciinema's marker syntax (`a` key
during playback) so they don't clutter the cast.

## demo-script.sh — the recorded commands

```bash
#!/usr/bin/env bash
set -e

# Beat 1 — empty state (4s)
clear
jht status
sleep 2

# Beat 2 — spawn (5s)
jht team start --roles capitano,scout
sleep 3

# Beat 3 — Scout discovers (6s)
# (Scout runs autonomously; we just tail the dashboard tile so the
# 0 → 7 transition lands inside the window)
jht web tail --tile positions
# ... 5s of natural agent output ...
^C    # send SIGINT once the tile shows 7

# Beat 4 — pipeline timelapse (8s)
# Pre-recorded fixture: replay an 8s segment of pipeline log from a
# previous run. The cast is stitched in post; this command is the cue.
jht sentinella tail --fixture demo-pipeline-timelapse
sleep 8

# Beat 5 — outputs (5s)
ls -lah ~/.jht/applications/
# Open the first PDF for half a second — relies on `qlmanage -p` on
# macOS or `xdg-open` on Linux; both quit cleanly on the next command.
open ~/.jht/applications/*.pdf
sleep 1
pkill -f Preview || true

# Beat 6 — outro (2s)
clear
cat <<'EOT'
                         Job Hunter Team
              github.com/leopu00/job-hunter-team

         AI on the side of workers, not against them.
EOT
sleep 2
```

> The `--fixture` flag and `--demo-profile` flag don't exist yet in the
> CLI. Two small additions live on the punch list below; the demo can't
> be deterministic without them. (If we don't want to add them: drop
> beat 4 and accept a less smooth recording.)

## Caption / voiceover (optional)

We're shipping the GIF muted; captions only. If the press kit needs an
MP4 with voice, this is the 30s read:

> "Empty install. We start the team — Captain, one Scout.
> The Scout finds seven openings; the Analyst keeps three; the Scorer
> ranks them; the Writer drafts a tailored CV and cover letter for
> each. Thirty seconds later, three applications ready in your
> applications folder. Open source, runs locally, your subscription.
> Job Hunter Team."

108 words, ≈ 28 seconds at a relaxed pace. Don't go faster than that —
HN viewers half-watching while reading need the words to land.

## Embed plan

### README
Replace the `## 🎬 Demo` placeholder at the top of `README.md` (line ~43)
with:

```markdown
## 🎬 Demo

<p align="center">
  <a href="https://asciinema.org/a/REDACTED">
    <img src="assets/demo.gif" alt="Job Hunter Team — 30 second demo" width="800" />
  </a>
</p>

<p align="center">
  <em>Empty install → first 3 tailored applications, 30 seconds.</em>
  <a href="https://asciinema.org/a/REDACTED">Click for full asciinema (audio-free)</a>.
</p>
```

Push `demo.cast` to asciinema.org too — gives us a permanent text-mode
backup if the GIF ever breaks, and the asciinema URL goes into the
press kit.

### Show HN post
The HN post body already references "screenshots/GIF" but doesn't embed
images (HN strips them anyway). Instead, drop the asciinema URL as the
first link under the architecture bullet list, with a one-line label:
"30-second demo — fresh install to first applications, no narration."

### Press kit
Both `demo.cast` and `demo.gif` ship in `assets/press-kit/`. Add an
MP4 conversion only if a journalist asks; not worth the bitrate
budget pre-emptively.

## Punch list before recording

- [ ] `jht setup --demo-profile` flag exists (loads a canonical
      profile so the Scout query returns deterministic results)
- [ ] `jht sentinella tail --fixture <name>` flag exists OR delete
      beat 4 (the timelapse is the only beat that needs a fixture)
- [ ] `docs/launch/demo-profile.yml` shipped — anonymised profile,
      synthetic name, public companies only
- [ ] Demo SQLite snapshot committed under `assets/demo-fixtures/`,
      gitignored from the main flow (not loaded by `jht setup` by
      default)
- [ ] First take recorded, total length verified ≤ 30s, GIF size
      ≤ 2.5 MB
- [ ] Asciinema cast uploaded to asciinema.org, URL substituted in
      the README embed snippet
- [ ] README PR + Show HN draft updated with the real GIF link
