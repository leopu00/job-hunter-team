# agent-harness/runtime — product roles on the API

The runtime that runs Job Hunter Team's roles (SCOUT, ANALYST…) on pay-per-use
API calls instead of a TUI subscription. It is a port of Home Hunter Team's
runtime (`home-hunter-team/src/core`, `src/tools`, `src/cli/monitor.ts`), so
the design notes live in HHT's ADRs 0001–0005; this file covers what differs
and how to run it.

`../app/` is a separate, hand-written Python exercise and is not part of this.

## Commands

```sh
npm install
npm test               # offline: mock provider, no key, no network
npm run typecheck
npm run role -- --role demo --prompt path/to/prompt.md --task "Start."
npm run monitor        # follow live runs; --list, --last, <run-id>, --verbose
```

`npm run role` runs one role headless. Without `--mock-script` the mock plays
a built-in rehearsal (todo list, file tools, bash, a subagent, a reply), so any
prompt can be exercised end to end for free. Each run writes:

| What | Where |
| --- | --- |
| trace (everything said and touched, 0600) | `~/.jht-api/logs/<role>/<runId>.jsonl` |
| sanitised audit (counts, codes, cost) | `~/.jht-api/audit/<runId>.jsonl` |
| the role's home, fresh each run | `~/.jht-api/agents/<role>/` (`AGENTS.md` = the exact prompt) |

## Configuration (`JHT_API_*`)

| Variable | Meaning |
| --- | --- |
| `JHT_API_PROVIDER` | `mock` (default), `openai`, `anthropic`, `openai-compatible` |
| `JHT_API_LIVE=1` | required for anything but the mock |
| `JHT_API_MODEL` | required live; priced from the catalogue or `JHT_API_PRICE_*_PER_MTOK` |
| `JHT_API_BUDGET_USD` | required live, > 0: the hard cap for the run |
| `JHT_API_LEDGER` | required live: the team's spend TSV (`agents-hq/ledger/openai-spesa.tsv`) |
| `JHT_API_OPENAI_BASE_URL` / `OPENAI_BASE_URL` | OpenAI through a key proxy, e.g. `http://127.0.0.1:8787/v1` |
| `JHT_API_HOME` | state root (default `~/.jht-api`) |
| `JHT_API_WORKDIR`, `JHT_API_PROFILE_DIR` | where commands start; the candidate profile, read freely |
| `JHT_API_PERMISSION_MODE` | `auto` (default), `ask`, `read-only` |
| `JHT_API_MCP_CONFIG` | MCP servers to connect (Claude Code's JSON shape) |
| `JHT_API_KEEP_HOME=1` | keep the role's home between runs |

A live run that cannot be priced, capped or recorded does not start. Every live
run appends one line to the ledger however it ends — completed, failed or
stopped — because the money it spent is spent. The mock writes nothing there.

The key is read from the environment (or a gitignored, 0600 `.env` next to
`package.json`). On a VPS the agent should hold only a placeholder and reach
OpenAI through a key proxy: `bash` runs as the agent's uid, so a key the
process can read is a key the model can print.

## Boundaries

- `ai` and `@ai-sdk/*` are imported only in `src/core/provider/ai-sdk.ts`;
  everything else speaks `ProviderPort`.
- `web_fetch` goes through `api-worker/src/safe-http.ts` (https only, every hop
  resolved and pinned to public addresses). An image built from this folder
  must copy that file to the same relative path.
- Paths are resolved through symlinks before the permission policy sees them.
  Credential files and other roles' state (`~/.jht-api` outside the role's own
  folders) are refused; `bash` gets an allowlisted environment.
- The permission gate is not a sandbox: in `auto`, `bash` can read anything the
  process can. Isolation is the container's job (`tests/security.test.ts`).
