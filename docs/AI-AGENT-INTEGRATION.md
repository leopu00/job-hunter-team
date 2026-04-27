# AI Agent Integration

## Your AI assistant can run JHT for you

JHT exposes a complete CLI — `jht` — that is *intentionally* designed to be driven by other AI agents, not just by humans.

If you already use a personal AI assistant (Claude Code, OpenClaw, Codex, Cursor, …), you can simply tell it:

> *"Set up JHT and start the team for me."*

…and it will figure out the rest. No manual configuration, no reading 5 pages of docs, no Docker commands typed by hand.

This is one of JHT's primary design decisions. It matters because:

- 🤖 **AI-native users are the early adopters of JHT.** People comfortable enough to delegate setup to an AI assistant are the same people who get the most value out of an autonomous agent team.
- ⏱️ **Setup time → seconds**. The AI assistant handles the OS-specific details, the dependency check, the credential prompts, the first-run wizard.
- 🔧 **The same CLI is used by humans, by AI agents, and by the Desktop launcher** — one surface, one source of truth.

## What an AI agent needs to know

Tell your agent the following (or just paste this section into its context):

```
Job Hunter Team is a multi-agent job-hunting framework. Drive it with the `jht` CLI:

  jht doctor              # check prerequisites (Docker, providers, profile)
  jht setup               # interactive setup wizard
  jht providers list      # see available LLM providers
  jht providers add       # add a subscription (Claude, Kimi, …)
  jht config              # view / edit team configuration
  jht agents list         # list agents and their state
  jht team start          # start the team in container
  jht team status         # check team status
  jht team stop           # stop the team
  jht tui                 # open the TUI dashboard

After `jht team start`, the user interacts with the team via:
  - Web dashboard (auto-opens in browser, localhost)
  - Telegram bot (if configured)
  - Direct CLI: jht ask <agent> "<message>"

Configuration files:
  - candidate_profile.yml      # the user's profile
  - .env                        # provider keys / subscription tokens

Subscription model: JHT uses LLM subscriptions, not pay-per-use. See docs/PROVIDERS.md.
```

## Example prompts

### Claude Code
```
Set up Job Hunter Team in this folder. I have a Claude Max x20 subscription. Walk me through what you need.
```

### OpenClaw / autonomous agents
```
Install and configure JHT for a full-stack developer profile. Use Kimi as the provider. Start the team and report back when it's running.
```

### Cursor / IDE-embedded agents
```
Add JHT to this project: install the CLI, run jht doctor, fix any issues, then start the team.
```

## What the AI agent should NOT do automatically

- 🛑 **Never push API keys or subscription tokens to git.** All secrets go in `.env` (gitignored).
- 🛑 **Never auto-submit applications.** JHT produces "Ready for submission" packages — the human decides what to send.
- 🛑 **Never overwrite the user's `candidate_profile.yml`** without confirmation — that file is the user's identity in the system.

## CLI completeness — the rule

If a feature requires opening the web dashboard or the Desktop app to be configured, that's a bug. The CLI must be self-sufficient. File an issue if you find an exception.

## Related

- [`docs/cli-install.md`](cli-install.md) — full CLI reference
- [`docs/quickstart.md`](quickstart.md) — the human-friendly version of this guide
- [`docs/PROVIDERS.md`](PROVIDERS.md) — which subscription to pick
