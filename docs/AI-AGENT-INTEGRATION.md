# AI Agent Integration

## Your AI assistant can run JHT for you

JHT exposes a complete `jht` CLI that is *intentionally* designed to be driven by other AI agents, not just by humans. If you already use a personal AI assistant (Claude Code, 🦞 OpenClaw, Codex, Cursor, …), just point it at this repo:

> *"Set up Job Hunter Team from https://github.com/leopu00/job-hunter-team for a [your role] profile. I have a [your subscription]. Walk me through what you need."*

It will read the docs, install the CLI, run `jht doctor`, fix any issues, and start the team.

This is one of JHT's primary design decisions:

- 🤖 **AI-native users are JHT's early adopters** — same people comfortable delegating setup to an AI get the most out of an autonomous agent team
- ⏱️ **Setup time → seconds**, not 5 pages of docs
- 🔧 **One CLI surface** for humans, AI agents, and the Desktop launcher

## What the AI agent should NOT do automatically

- 🛑 **Never push API keys or subscription tokens to git.** All secrets go in `.env` (gitignored).
- 🛑 **Never auto-submit applications.** JHT produces "Ready for submission" packages — the human decides what to send.
- 🛑 **Never overwrite the user's `candidate_profile.yml`** without confirmation — that file is the user's identity in the system.

## CLI completeness — the rule

If a feature requires opening the web dashboard or the Desktop app to be configured *after install*, that's a bug. The CLI must be self-sufficient for day-to-day operation. File an issue if you find an exception.

## Related

- [`docs/cli-install.md`](cli-install.md) — full CLI reference
- [`docs/quickstart.md`](quickstart.md) — the human-friendly version of this guide
- [`docs/PROVIDERS.md`](PROVIDERS.md) — which subscription to pick
