# 🛠️ Skill distribution — launcher-distributed isolation

> Moved verbatim from `docs/about/ROADMAP.md` in the 2026-07-03 docs restructure (the ROADMAP keeps only the strategic view). Empirical findings from 2026-04-28; decision and punch list unchanged.

## Empirical findings (2026-04-28)

Tested per-agent skill isolation across the 3 supported providers using a 3-cwd scaffold (`aldo` · `giovanni` · `giacomo`) on `~/Desktop/skill-isolation-test/`. Each subdir held one private skill (`china-time` · `translate-chinese` · `text-to-emoji`); the parent held one supposedly-shared skill (`shared-greeting`).

| Provider | Version | Per-cwd isolation | Walk-up to parent | Stop condition |
|---|---|---|---|---|
| **Claude Code** | 2.1.112 | ✅ confirmed | ✅ unconditional | filesystem root |
| **Codex** | 0.125.0 | ✅ confirmed | ⚠️ only if `.git/` exists in an ancestor | git repo root |
| **Kimi** | k2.5 | ✅ confirmed | ⚠️ same pattern as Codex (without `.git/` in test, parent skill not loaded) | git repo root (assumed) |

Codex's behaviour matches its [official documentation](https://developers.openai.com/codex/skills): *"Codex walks up the directory tree from your current working directory to the repo root"* — repo root defined as a `.git/` ancestor; without it, "Codex only checks the current directory".

## The blocker for naive walk-up: container has no `.git/`

The repo's `.dockerignore` excludes `**/.git`, so `COPY . .` in the Dockerfile produces an `/app/` without a `.git/` directory. Inside the runtime container:

- ✅ Claude Code would walk up freely and see `/app/.claude/skills/` from any agent's cwd
- ❌ **Codex and Kimi would NOT walk up** (no `.git/` to anchor "repo root") → they'd see only the agent's own `<role>/.agents/skills/` and never the shared pool

Re-introducing `.git/` into the container just to enable walk-up would inflate the image, leak history, and add provider-specific magic.

## Decision: launcher-distributed symlinks, provider-agnostic

The launcher (`.launcher/start-agent.sh` or a bootstrap step) populates each agent's `.claude/skills/` *and* `.agents/skills/` with symlinks to the right subset of skills, drawn from a single canonical pool.

**Target layout (current):**

```
/app/agents/_skills/                                  ← global pool (linked to every agent)
   _lib/                                                 ← shared Python deps (used by multiple skills)
   db-query/SKILL.md     + db_query.py                   (script colocation: future commit)
   db-update/SKILL.md
   db-insert/SKILL.md
   rate-budget/SKILL.md
   tmux-send/SKILL.md

/app/agents/sentinella/_skills/                       ← Sentinel-private pool
   decision-throttle/SKILL.md
   emergency-handling/SKILL.md
   check-usage-http/SKILL.md
   check-usage-tui/SKILL.md
   memory-state/SKILL.md
   order-formats/SKILL.md

/app/agents/<role>/_skills/                           ← future per-role privates

/app/agents/<role>/.claude/skills/                    ← populated at boot via symlink
/app/agents/<role>/.agents/skills/                       (Codex + Kimi mirror)
```

At team setup, for each role the launcher creates symlinks under `agents/<role>/.claude/skills/` and `agents/<role>/.agents/skills/` pointing to:

1. Every entry under `agents/_skills/` (excluding `_lib/`)
2. Every entry under `agents/<role>/_skills/` (if the dir exists)

Each Claude / Codex / Kimi instance launched from `cwd = /app/agents/<role>/` then sees exactly its allowed set in its **immediate** `.claude/skills/` (or `.agents/skills/`) — no parent walk-up needed, identical behaviour across all 3 providers.

## Why this is better than walk-up

- ✅ **Provider-uniform** — works the same on Claude / Codex / Kimi regardless of `.git/`
- ✅ **Container-light** — no need to ship `.git/` in the image
- ✅ **Explicit** — what each agent sees is determined by the symlink set, not by filesystem-search heuristics
- ✅ **Extensible** — adding a `scout-only` skill is a one-line entry under `agents/scout/_skills/`; per-role and shared pools coexist cleanly
- ✅ **Multi-role groups** — future need for "shared between Captain and Assistant only"? Add `agents/_skills-cap-asst/` (or similar manifest) and update the distributor's role→pool mapping

## Implementation punch list

```
✅ Move .skills-source/* -> agents/_skills/* (global skills relocated)
✅ Convert agents/sentinella/skills/*.md (plain markdown) into
   agents/sentinella/_skills/<name>/SKILL.md (folder + frontmatter:
   name, description, allowed-tools) — Agent Skills format
✅ Promote db-insert to a SKILL.md wrapper under agents/_skills/db-insert/
✅ Update Dockerfile symlink loop to source from agents/_skills/ instead
   of .skills-source/ (kept global flat for now)
✅ Add the per-agent distribution step to .launcher/start-agent.sh:
   reads agents/<role>/skills.list manifest + always-copies
   agents/<role>/_skills/, populates <agent_cwd>/.claude/skills/ and
   <agent_cwd>/.agents/skills/ via cp -R at each spawn
   (commit e220114c, "feat(skills): per-agent skill distribution via manifest")
✅ Drop the global Dockerfile symlink loop in favour of per-agent
   distribution at boot — the Dockerfile now only documents the
   architecture (lines 112-119), no more global farm of symlinks
   (same commit e220114c, provider-uniform: no .git/ needed)
✅ Move agents/_tools/jht-tmux-send into agents/_skills/tmux-send/ as a
   colocated artifact. Dockerfile gained a second `ln -sf` loop over
   `/app/agents/_skills/*/jht-*` so colocated `jht-*` scripts still land
   in `/usr/local/bin/`. References in sentinella.md, sentinel-orders,
   order-formats, anti-collision, web/api/team/messages updated.
   (`agents/_tools/` kept: still hosts jht-send + the throttle/notify
   wrappers, not all script families have moved yet.)
⬜ Move 1:1 Python scripts into their skill folders + create
   agents/_skills/_lib/ for shared deps (_db.py, compute_metrics.py,
   usage_record.py); update sys.path imports + the ~10 prompt files
   that reference /app/shared/skills/<x>.py absolute paths
⬜ Update CONTRIBUTING + agents/_team/architettura.md (Skills section)
   to describe the new layout and how to add a skill (drop into
   agents/_skills/ for shared, into agents/<role>/_skills/ for private)
✅ Add a deterministic distribution smoke test (`tests/test_skill_distribution.py`):
   run the real `jht_spawn_copy_skills` against temporary shared/private pools
   and a role manifest; assert the exact same isolated set under both
   `.claude/skills/` and `.agents/skills/`, with `_lib/`, unlisted shared
   skills, stale output and another role's private skills excluded
   (`JHT-SKILLS-SYMLINK-TEST`, commit 687f6903b4)
⬜ Full-team integration test inside the container: spin up the actual
   JHT team (Captain + Scout + Analyst + Scorer + Writer + Critic +
   Sentinel + Assistant), drive a real run end-to-end, and verify each
   agent INVOKES the right skills (not just sees them) — i.e. that
   db-query / db-update / db-insert / rate-budget / tmux-send actually
   get called from the agent prompts as expected, and that Sentinella's
   private skills (decision-throttle, emergency-handling, etc.) are
   loaded only by Sentinella. Capture pane logs + DB diffs for evidence.
```

## Reproducible test scaffold

The launcher-distribution contract has a local, provider-free regression gate:

```bash
python -m pytest tests/test_skill_distribution.py -q
```

It creates temporary `agents/_skills/`, `agents/<role>/_skills/` and
`skills.list` fixtures, then invokes the production distributor from
`.launcher/spawn-lib.sh`. The manifest remains the authority for shared skills;
the role-private directory remains the authority for private skills. No LLM,
tmux team or container is started.

The provider discovery check below remains a runtime compatibility test, not a
replacement for this deterministic distribution test. In particular, it is
still required after a Claude/Codex/Kimi discovery behaviour change and is
tracked separately as `JHT-SKILLS-CODEX-KIMI-DISCOVERY`.

The 3-cwd test on `~/Desktop/skill-isolation-test/` (with `CLAUDE.md` + `AGENTS.md` per agent and one private skill each) is preserved for future regression checks against new provider versions or new providers (e.g. OpenCode when added — see ADR-0002). To re-run for any provider, swap the launch command in the tmux step:

- Claude Code: `claude.exe --dangerously-skip-permissions`
- Codex: `cmd.exe /c codex --yolo` (Windows-host; in WSL needs Windows interop)
- Kimi: `kimi.exe --yolo`

Each session is sent the same prompt (*"list all skills you currently have available"*), and panes are captured with `tmux capture-pane -t <session> -p`. The expected outcome with the launcher-distribution model: every agent reports `_global/* + <its role>/*` and nothing else.
