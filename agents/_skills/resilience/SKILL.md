---
name: resilience
description: When a mission-critical tool fails, NEVER degrade silently or report "queue exhausted"/new=0. Classify broken-vs-empty, then climb the fallback ladder — auto-repair via jht-install, retry, alternative method, mark OPEN_UNVERIFIED, escalate to the Capitano with the exact fix. Use whenever a tool you depend on (browser, linkedin_check, a fetch, a CLI) errors or a dependency is missing.
---

# resilience — never give up silently on a broken tool

## Why it exists

A mission-critical tool (LinkedIn verification via Playwright) died because a system library was
missing. Agents reported "can't verify" and silently fell back to "queue empty" — the failure was
discovered downstream after hours of `new=0`. This skill makes tool failure **loud and
recoverable** instead of silent and fatal.

## The core rule

**A broken tool is NOT an empty result.** Before you ever write "queue exhausted", `new=0`, or
"nothing to do", you MUST self-check the tool you depend on. If the tool is broken, you do not have
"no work" — you have a **repair to do** or an **escalation to raise**.

## The fallback ladder — climb in order, stop at the first that succeeds

1. **Detect & classify.** Tool exited non-zero / missing dependency / load error
   (`exitCode 127`, `cannot open shared object file`, `command not found`, `error while loading
   shared libraries`) → **BROKEN**. Tool ran clean and returned zero items → **EMPTY** (genuine).
   Only EMPTY justifies "no work".
2. **Auto-repair.** Restore the missing dependency via **`jht-install`** (the canonical wrapper —
   it routes system/python/node/browser correctly and uses the `sudo apt` you already have). Then
   **retry the original tool**.
   *Example:* browser fails with `cannot load libatk-1.0.so.0` → `jht-install` the browser system
   deps (`playwright install-deps` / `sudo apt-get install` the lib) → relaunch.
3. **Alternative method.** If the primary tool can't be repaired in-loop, switch method toward the
   same goal:
   - LinkedIn: use the HTTP guest fetch, or verify liveness on the company's **canonical
     careers/ATS page** (Greenhouse / Lever / Ashby / Workable). **Never** trust a LinkedIn HTTP 200
     — the authwall returns 200 for closed jobs too.
4. **Mark, don't drop.** If still inconclusive, leave the data state **UNCHANGED** and tag it
   `OPEN_UNVERIFIED` + a `NOTE_MISMATCH`. Never silently overwrite with a guess.
5. **Escalate (within the 2-3 attempt ceiling, see below).** Tool broken and not repairable in
   ≤2-3 shots → message the **Capitano** with the EXACT fix: the failing command, the missing
   dependency, and the `jht-install` / Dockerfile line that resolves it. Then **keep working via the
   alternative method** (or move to another source) — do not stall, but **do not push past the
   ceiling** either.

## What this forbids

- ❌ Writing "queue exhausted" / `new=0` / "nothing to verify" when the real cause is a tool error.
- ❌ Falling back to a known-unreliable signal (e.g. LinkedIn `200` = "open") and calling it verified.
- ❌ Reporting a blocker and then going idle. Report **and** keep working via the alternative.

## Classify before you claim "empty"

Canonical classifier — the shared `tool_health` smoke-test checks the whole critical set in one shot
(`status` OK|BROKEN|UNKNOWN per tool, exit 1 if any is broken). Run it before reporting "no work":

```sh
# If a critical tool is BROKEN, you do NOT have an empty queue — you have a repair/escalation.
if ! python3 /app/shared/skills/tool_health.py >/tmp/tools_health.json 2>&1; then
  echo "A critical tool is BROKEN -> jht-install + retry -> alternative -> escalate. NOT 'empty'."
fi
```

Per-tool inline check (when you only depend on one tool in-loop):

```sh
out=$(JHT_HOME=/jht_home python3 /app/shared/skills/linkedin_check.py "$JOB_ID" 2>&1); rc=$?
if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qiE 'libatk|shared librar|exitCode 127|cannot open'; then
  echo "BROKEN -> repair + retry + alternative; NOT a genuine EMPTY."
else
  echo "tool OK -> a zero result here is a genuine EMPTY."
fi
```

## ⛔ Stubbornness ceiling — max 2-3 attempts, then ESCALATE (2026-06-26)

Stubbornness has a **budget**, it is NOT infinite. For a source/tool that keeps failing make **at
most 2-3 real attempts** (e.g. `repair+retry`, then **ONE** alternative) — do **not** build wrapper
upon wrapper, and do not loop dozens of times. *That was exactly the scout-6 marathon: 54 LinkedIn
scrapes + 42 web searches + a bespoke playwright run for **3** insertions, ~308 kT burned.* The
*resilience ladder* needs a ceiling, otherwise it becomes a token pit.

Once the 2-3 attempts are spent:
1. **Stop on that source** — do not push further.
2. Leave the data `OPEN_UNVERIFIED` (never overwrite with a guess) **or** move to another
   source/circle (round-robin, do not drain the same one).
3. **Escalate to the Capitano** with the exact diagnosis (the failing command, the missing
   dependency, the `jht-install`/Dockerfile line that resolves it). **He decides** whether it is
   worth insisting, repairing upstream, or dropping that circle.

Mission-critical (browser / LinkedIn) = insist **up to the ceiling**, not forever; and only from
official sources. A broken tool stays a **repair/escalation**, not an "empty queue" — but the repair
costs at most 2-3 shots, and after that it is the Capitano who decides.
