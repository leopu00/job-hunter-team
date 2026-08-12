# 🛠️ Skill distribution — launcher-distributed isolation

> Moved verbatim from `docs/about/ROADMAP.md` in the 2026-07-03 docs restructure (the ROADMAP keeps only the strategic view). Empirical findings from 2026-04-28; decision and punch list unchanged.

## Empirical findings (2026-04-28)

Tested per-agent skill isolation across the 3 supported providers using a 3-cwd scaffold (`aldo` · `giovanni` · `giacomo`) on `~/Desktop/skill-isolation-test/`. Each subdir held one private skill (`china-time` · `translate-chinese` · `text-to-emoji`); the parent held one supposedly-shared skill (`shared-greeting`).

| Provider | Version | Per-cwd isolation | Walk-up to parent | Stop condition |
|---|---|---|---|---|
| **Claude Code** | 2.1.112 | ✅ confirmed | ✅ unconditional | filesystem root |
| **Codex** | 0.125.0 | ✅ confirmed | ⚠️ only if `.git/` exists in an ancestor | git repo root |
| **Kimi** | k2.5 | ✅ confirmed | ⚠️ same pattern as Codex (without `.git/` in test, parent skill not loaded) | git repo root (assumed) |

Codex's behaviour matches its [official documentation](https://developers.openai.com/codex/skills/): Codex scans `.agents/skills` from the current working directory up to the repository root.

## Official discovery contract audit (2026-08-12)

Primary sources consulted:

- [OpenAI — Build skills / Where Codex loads local skills](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
- [Moonshot AI — Kimi Code CLI Agent Skills / Skill discovery](https://moonshotai.github.io/kimi-cli/en/customization/skills.html#skill-discovery)
- [Moonshot AI — Kimi data locations](https://moonshotai.github.io/kimi-cli/en/configuration/data-locations.html)

| Provider | Documented project discovery | Consequence for JHT |
|---|---|---|
| Codex | `.agents/skills` in each directory from CWD through the Git repository root; symlinked skill folders are supported | Populate the role CWD's `.agents/skills` |
| Kimi | At the nearest Git root, or at CWD when no `.git` exists: brand group `.kimi/skills`, `.claude/skills`, `.codex/skills`, plus generic `.agents/skills`; brand wins same-name conflicts | Populate only generic `.agents/skills` so the same JHT skill is not duplicated across brand and generic scopes |

Kimi's documentation also states that `KIMI_SHARE_DIR` controls runtime data,
not skill discovery. The JHT choice of the generic Kimi scope is an
implementation decision inferred from the documented precedence rules, not a
claim that Kimi lacks `.claude/skills` support.

Decision: the distributor is provider-aware. It removes both runtime discovery
trees on every spawn, then copies the manifest-selected shared skills and the
role-private skills to `.claude/skills` for Claude or `.agents/skills` for
Codex/Kimi. If the provider is absent or unknown, it preserves the historical
dual-copy fallback. This keeps `skills.list` and each role's `_skills/` as the
only content authorities.

## The blocker for naive walk-up: container has no `.git/`

The repo's `.dockerignore` excludes `**/.git`, so `COPY . .` in the Dockerfile produces an `/app/` without a `.git/` directory. Inside the runtime container:

- ✅ Claude Code would walk up freely and see `/app/.claude/skills/` from any agent's cwd
- ❌ **Codex and Kimi would NOT walk up** (no `.git/` to anchor "repo root") → they'd see only the agent's own `<role>/.agents/skills/` and never the shared pool

Re-introducing `.git/` into the container just to enable walk-up would inflate the image, leak history, and add provider-specific magic.

## Decision: launcher-distributed role copies, provider-aware

The launcher populates the active provider's discovery directory with copies
of the right subset drawn from a single canonical pool. The ticket retains the
historical `SYMLINK` name, but the production distributor has used `cp -R`
since commit `e220114c`; tests exercise that real copy contract.

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

/app/agents/<role>/.claude/skills/                    ← Claude runtime copy
/app/agents/<role>/.agents/skills/                    ← Codex/Kimi runtime copy
```

At spawn, for each role the launcher copies into the active provider's runtime
directory:

1. Every entry under `agents/_skills/` (excluding `_lib/`)
2. Every entry under `agents/<role>/_skills/` (if the dir exists)

Each provider launched from `cwd = /app/agents/<role>/` sees exactly its
allowed set in its immediate supported directory. No parent walk-up is needed.
Unknown providers retain the dual-copy fallback.

## Why this is better than walk-up

- ✅ **Provider-aware** — uses each CLI's documented scope without depending on `.git/`
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
✅ Verify current Codex/Kimi discovery against primary vendor documentation;
   make distribution provider-aware, retain dual-copy fallback, and test
   Claude/Codex/Kimi destinations without launching an LLM
   (`JHT-SKILLS-CODEX-KIMI-DISCOVERY`, commit 8edc2bbb8c)
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

The provider-free contract test now pins the documented Claude/Codex/Kimi path
mapping and the dual-copy fallback. A real CLI smoke remains useful after a
provider discovery change, but is not required for this documentation audit.

The 3-cwd test on `~/Desktop/skill-isolation-test/` (with `CLAUDE.md` + `AGENTS.md` per agent and one private skill each) is preserved for future regression checks against new provider versions or new providers (e.g. OpenCode when added — see ADR-0002). To re-run for any provider, swap the launch command in the tmux step:

- Claude Code: `claude.exe --dangerously-skip-permissions`
- Codex: `cmd.exe /c codex --yolo` (Windows-host; in WSL needs Windows interop)
- Kimi: `kimi.exe --yolo`

Each session is sent the same prompt (*"list all skills you currently have available"*), and panes are captured with `tmux capture-pane -t <session> -p`. The expected outcome with the launcher-distribution model: every agent reports its manifest-selected shared skills plus its role-private skills and nothing else.
