# agent-harness — the loop, written by hand

*Versione italiana: [`README.it.md`](README.it.md).*

**This is not production code and it is deliberately incomplete.** It is the harness I am building
myself, line by line, without handing it to an agent. The value is in the gesture, not the result:
Job Hunter Team's real orchestration stays the tmux/CLI one — this grows next to it.

## Where it comes from

The starting file is `app/main.py`, born as my solution to the CodeCrafters challenge
*Build your own Claude Code* and grown from there. The same file also lives on my work machine
inside another project, where it is called `FincoBot/app/fincobot.py`: **same code base, two
destinations**, so the exercise continues from either machine.

It drives the `openai` SDK against an OpenAI-compatible endpoint, which is already the shape of the
multi-provider adapter: one client covers Claude, GPT and Kimi by changing `BASE_URL` and `MODEL`.

## Running it

```sh
cp .env.example .env      # then fill in key, base url and model
./run.sh -p "What is the content of pyproject.toml?"
```

On Windows, from the work machine:

```powershell
.\run.ps1 -p "What is the content of pyproject.toml?"
```

Both scripts do the same thing: `cd` into the script's own directory (so every path stays relative),
load `.env`, and run `uv run --project . -m app.main`. The environment is isolated from the rest of
the repo — `pyproject.toml` applies here only.

The program prints **the final answer on `stdout`** and **all observability on `stderr`**: round
number, input and output tokens, running totals, the turn's marginal cost, and a JSON dump of the
new messages. To read the answer alone: `./run.sh -p "..." 2>/dev/null`.

## What's missing

[`TODO.md`](TODO.md) — nine known gaps, written as symptom plus verification criterion and
**without solutions**, on purpose: writing them is the exercise. Three are closed, six remain open.
Next up is the step cap.

## The notes

The line-by-line reasoning, the field measurements and the dead ends live in
`lezioni/fincobot.md`, outside the repo (`lezioni/` is listed in `.git/info/exclude`).
That file holds the *why*; this folder holds the *what*.

## Scope

The exercise lives in this folder. It touches nothing else in the repo.
