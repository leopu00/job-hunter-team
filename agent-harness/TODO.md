# Agent loop — what's missing

*Italian version: [`TODO.it.md`](TODO.it.md).*

Starting baseline: `app/main.py`, copied from `codecrafters-claude-code-python/app/main.py`.
It runs against an OpenAI-compatible endpoint through the `openai` SDK, so it already has the shape
of the multi-provider adapter.

**Updated 4 Sep 2026** with the work done by hand on the work machine (there the file carries a
different name, here it's `app/main.py`: same code, same base). The file went from 165 to 206
lines and **gaps 5, 6 and 9 are closed**. The line-by-line reasoning lives in
`lezioni/agent-harness.md`, which stays out of the repo.

What follows is symptoms and verification criteria only. No solutions: writing them is the exercise.
Line numbers refer to `app/main.py` **as it stands now**, after the 4 Sep update.

---

## 1. No step cap — line 89 ⬜ OPEN

`while not finished` only exits when the model stops requesting tools. If it enters a cycle (reads
the same file again, retries a command that keeps failing) it spins until you kill it, and every
round is a paid API call.

**Verify:** feed it a prompt that induces a cycle and check the loop terminates on its own, with an
exit reason distinguishable from a normal completion.

## 2. Tool dispatch is closed — lines 152-196 ⬜ OPEN

An `if/elif` chain on `tool_name`, with each tool's logic inside the loop body. Adding a tool today
means editing the `while`, and the loop can no longer be read separately from the tools.

Note that `TOOLS` (lines 11-65) and the dispatch are two lists of the same three names in two
different places. Add a name to only one of them and you find out at runtime.

**Verify:** add a fourth tool without opening the `while` body, and without declaring its name twice.

## 3. A raising tool kills the run — lines 150, 158, 169, 180 ⬜ OPEN

`open()` on a path that doesn't exist, `json.loads` on malformed arguments, a `PermissionError` on
write: all of them raise, and the exception travels up to `main()`. The process dies with a
stacktrace and the conversation is lost.

The model is not infallible: it will get paths wrong and produce broken JSON. That is a normal case,
not a bug.

**Question to sit with:** in an agent loop, who needs to know the tool failed — the terminal, or the
model that has to decide the next move?

**Verify:** ask it to read a file that doesn't exist. The run must reach a sensible final answer, not
a traceback.

## 4. `Bash` can hang forever — line 180 ⬜ OPEN

`subprocess.run(..., shell=True)` with no `timeout`. An interactive command, or one waiting on
stdin, suspends the loop indefinitely. And `shell=True` on a string that comes from the model
deserves its own separate thought.

**Verify:** run a command that never returns. The loop must move on.

## 5. `response.usage` was discarded — ✅ CLOSED 4 Sep 2026 (lines 109, 122)

Every round now prints to `stderr` the input and output tokens, the running totals and — the part
that matters — the **delta against the previous round** (`input_tokens - previous_prompt_tokens`),
which is that turn's marginal cost. A `round` counter numbers the iterations.

Found by measuring rather than reading: **a turn's cost shows up one round late**, because the tokens
of what you append now are paid on the following call. Details in
`lezioni/agent-harness.md`, section *«Il principio del ritardo di un giro»*.

Still open on top of this: no **budget** that stops the run when spend crosses a threshold (ties into
gap 1), and the numbers go to `stderr` by hand instead of into a queryable structure.

## 6. BUG — `Write` sent the whole content back — ✅ CLOSED 4 Sep 2026 (lines 163-174)

`content` and `result` are now two distinct variables: `content` goes to the file, and what goes back
to the model is a short confirmation. `Read`'s tool result is still the file content, as it should be.

Measured before and after in the field: the difference shows in the next round's input tokens.

## 7. No system prompt — lines 77-79 ⬜ OPEN

`messages` starts with the user message alone. The agent has no instructions, no constraints and no
idea which directory it is working in: what it does depends entirely on the defaults of whichever
model sits behind the endpoint, and those change when `MODEL` changes.

**Verify:** the same prompt on two different models should produce comparable behaviour.

## 8. `finish_reason` never inspected — line 105 ⬜ OPEN

You take `.message` and ignore why the model stopped. If it stopped for `length` (truncated output)
you can end up with an incomplete tool call that you append to `messages` anyway, and the next
request fails provider-side.

**Verify:** lower `max_tokens` until it truncates mid tool call, and watch what happens.

## 9. The history was a mixed list — ✅ CLOSED 4 Sep 2026 (line 128)

Not in the original list: it surfaced while printing the messages. `messages` held both hand-written
dicts and SDK objects (`ChatCompletionMessage`), so `json.dumps` over the list broke and no reader
could treat it uniformly.

It now appends `msg.model_dump(exclude_none=True)`: **the conversion happens at the boundary**, the
moment the data enters the house, and from there on the history is homogeneous. One reader prints
all of it.

See `lezioni/agent-harness.md`, sections *«La history è una lista mista»* and
*«Stampa: non scrivere un lettore per ogni forma»*.

---

## Where to pick up (4 Sep 2026)

In order, as the tutoring session left them:

1. **Gap 1 — step cap.** The most urgent: with no ceiling, every other defect costs real money until
   you kill the process by hand.
2. **Gap 3 — exceptions returned to the model.** The one that changes the agent's behaviour most: an
   error becomes information instead of an ending.
3. **Gap 2 — registry.** After 3, otherwise you write the error handling twice.

Session rule, to be kept: **Leone writes the code by hand.** The notes under
`lezioni/` hold the reasoning, not the solutions.

---

## Environment prerequisite

This folder carries its own `pyproject.toml` (with `requires-python = ">=3.14"`), so it does not depend on the
repo's `requirements.txt` (which deliberately has no `openai`). If the harness is ever grafted onto
the rest of the project, that pin has to be reconciled.

## Out of scope for now

Not for today, but it is where the road leads:

- A native Anthropic adapter alongside this one, for real cache-write and usage figures.
- `ModelProfile` with capabilities and prices, so the profile decides what a model is allowed to do.
- A `mock` provider, to test the loop without spending tokens.
