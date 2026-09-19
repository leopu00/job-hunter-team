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
npm run role -- --role scout --agent scout-1 --turns 2   # a product role, as its TUI twin
npm run role -- --role analista --agent analista-1 --turns 2   # the ANALISTA (T14)
npm run role -- --role demo --prompt path/to/prompt.md --task "Start."
npm run monitor        # follow live runs; --list, --last, <run-id>, --verbose
```

`npm run role` runs one role headless. Without `--prompt` the role is a
product role: prompt, skills and team docs come from `agents/<role>/` by the
TUI launcher's rules, the `_tools` commands are native tools, and `--turns`
and `--pause-ms` drive its cycle (`docs/parity.md`). Without `--mock-script` the mock plays
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
| `JHT_API_BUDGET_USD` | required live, > 0: the hard cap for the run; a model call or a search whose worst case does not fit in what is left does not start |
| `JHT_API_MAX_WEB_SEARCHES` | searches per run, as the provider ran them (default 8, `0` = none); past it `web_search` answers without calling the provider. The count is in the monitor and in the ledger's note (`web_searches=N`) |
| `JHT_API_LEDGER` | required live: the team's spend TSV (`agents-hq/ledger/openai-spesa.tsv`) |
| `JHT_API_OPENAI_BASE_URL` / `OPENAI_BASE_URL` | OpenAI through a key proxy, e.g. `http://127.0.0.1:8787/v1` |
| `JHT_API_HOME` | state root (default `~/.jht-api`) |
| `JHT_API_WORKDIR` | where commands start |
| `JHT_API_PROFILE_DIR` | the person's profile: the rendered prompt points at it, every role reads it, no tool writes in it |
| `JHT_API_DB` | the team's `jobs.db` (default `<JHT_API_HOME>/db/jobs.db`), created with the product's schema if missing; reached only through the db tools |
| `JHT_API_APP_ROOT` | the folder holding `agents/` (default this checkout; `/app` in the image) |
| `JHT_HUB_URL` + `JHT_HUB_TOKEN` | the team's database and channels are `jht-hub`'s (`docs/hub.md`): this runtime opens neither. Loopback URL only. A CAPITANO on the hub gets `spawn_agent`, `stop_agent` and `list_agents` (`docs/launcher.md`) |
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

## On the VPS

The image (`agents/`, this folder and `api-worker/src/safe-http.ts`, no
`shared/`, no Python) runs under podman in a pod with a key proxy. The launch
script and the proxy belong to the VPS configuration, not to this repo; what
they set is this:

| | How |
| --- | --- |
| mock run | `run.sh mock scout --agent scout-1 --turns 2 --pause-ms 0`: `--network=none`, `JHT_API_PROVIDER=mock`, same mounts as live |
| live run | `run.sh live scout <model> <usd> --agent scout-1`: `JHT_API_LIVE=1`, `JHT_API_MODEL`, `JHT_API_BUDGET_USD=<usd>` |
| caps | the run's USD budget (the cap that counts), the token cap on input not served from the cache, and the proxy's cumulative ceiling across runs with its model allowlist |
| key | only the proxy container holds it; the agent gets `OPENAI_BASE_URL=http://127.0.0.1:8787/v1` and a placeholder key |
| profile | mounted read-only at `/jht_home/profile`, `JHT_API_PROFILE_DIR=/jht_home/profile`: read-only twice, in the container and in the policy |
| jobs.db | its own volume at `/jht_home/db`, `JHT_API_DB=/jht_home/db/jobs.db`: a new database, never a copy of a person's |
| ledger | one line per live run in `JHT_API_LEDGER`, copied to the team's spend TSV |
| test | `run.sh test`: `npm test` in the container, network closed. Without Python the parity comparisons skip (about 90); nothing fails |

To read a run, `run.sh monitor --last` (or `--list`, `<run-id>`, `--verbose`)
replays its trace. That is the same view as `npm run monitor`, from the
`~/.jht-api` volume and read-only. The trace has the rendered system prompt,
every tool call with its outcome, the token counts and the cost.

## What the live runs cost (T5, 2026-09-19)

SCOUT, one turn per run, on `gpt-5.6-luna` through the key proxy. The figures
come from the spend ledger; the proxy's count matched the runtime's to the
cent in every run.

| Run | USD | New positions | USD / position | Rounds | Ended |
| --- | ---: | ---: | ---: | ---: | --- |
| T5 | 0.17 | 0 | — | 19 | completed, but blocked: no Python for the skills (the native db tools came from this) |
| T5-bis | 0.23 | 1 | 0.23 | 16 | stopped at the token cap, which then counted cached input |
| T5-ter | 0.36 | 2 | 0.18 | 21 | completed; the profile was not read (fixed in T10b) |
| T5-quater | 0.43 | 2 | 0.22 | 26 | completed; profile read first |

The baseline for the same role on a TUI subscription is 2.26 USD a session and
0.53 USD a position. The last two runs, the first comparable ones, came to
0.18 and 0.22 USD a position: 59–66 % less. That is 4 positions over 2
sessions, too small a sample to settle it. A runtime session is also shorter
than a TUI one (21–26 rounds, against a median of 74 calls), so the per-session
figures do not compare like for like.
Web search is 30–47 % of the spend of those runs.

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
