# 0002 — Support exactly three agent CLIs: Claude Code, Codex, Kimi

**Status:** Accepted
**Date:** 2026-04-16

## Context

Each JHT agent runs as a session of some AI CLI tool that reads a markdown config file describing its identity, role, and rules. The ecosystem is fragmented — Anthropic ships Claude Code, OpenAI ships Codex, Moonshot ships Kimi, and new entrants appear regularly.

We need to decide how many of these we actually support, and what the config contract is.

## Decision

Support **three agent CLIs**, no more:

- **Claude Code** — configured via `CLAUDE.md`
- **Codex** — configured via `AGENTS.md`
- **Kimi** — configured via `AGENTS.md`

The set is closed. Adding a fourth requires a new ADR.

## Consequences

- ✅ Each agent directory ships a single config file (`CLAUDE.md` or `AGENTS.md`) — no branching on runtime
- ✅ User can pick provider based on cost, quality, or API availability without changing JHT code
- ✅ Clear scope for testing and support
- ⚠️ Features that land in only one CLI (e.g. tool calling differences) need to be abstracted or gated
- ⚠️ The `CLAUDE.md` vs `AGENTS.md` duality has to be maintained in parallel until one becomes the de facto standard

## Alternatives considered

- **Only Claude Code** — rejected. Locks JHT to a single vendor, dependent on pricing and rate limits of one provider.
- **Any CLI / plugin system** — rejected. Too broad — forces us to maintain a generic adapter layer for runtimes we can't validate. "Support everything" means "supports nothing well".
- **Custom JHT-native runtime** — rejected. Reinventing a stable agent CLI is out of scope; the existing ones are good enough.
