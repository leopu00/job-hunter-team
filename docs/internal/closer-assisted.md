# Explicit assisted application lifecycle

This hotfix is based on runtime 789fa882f. Automatic execution retains its
existing cleanup. Assisted execution owns the actual Playwright runtime,
browser/context and Page outside `ApplicationFlow.run`, and holds the position
lock and, for a persistent LinkedIn context, the profile lock until cleanup.

## Start and inspect

Use an explicitly requested assisted run for one officially authorised position.
Obtain PID, URL and CV through the existing official queue/authorisation path.
Do not use this option to retry held or unknown applications.

```sh
python3 /app/shared/skills/apply_flow.py --assisted --assisted-ttl 1800 \
  --position-id "$PID" --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" --cv "$CV"
python3 /app/shared/skills/apply_assisted.py status --position-id "$PID"
```

`assisted_started` confirms owner startup, not a sent application. During the
initial flow the sequential controller may be busy. Query again after the flow
pauses. Status exposes codes and receipt presence, not page contents. A blocked
flow sends a notice and keeps its actual page alive. A private viewer can show
that display, but viewing alone supplies no mouse or keyboard input.

## Resolve and resume

If an official answer is saved without interacting with the page, resume uses
the same page and context with `navigate=False`:

```sh
python3 /app/shared/skills/apply_assisted.py resume --position-id "$PID"
```

Every resume re-reads the official consent/position gate and applicable
checkpoint, email, essential-information and cap holds. A newly blocked captcha
or site wall still requires renewed official position authorisation before
handoff; the owner keeps the page alive while that happens. It never renews
authorisation, clears a hold or resets a throttle itself. Revocation denies
control. Answer questions retain the existing queue policy.

## Actual human control and possible submission

This minimum implementation provides an explicit **local technical controller**,
not interactive control in a read-only viewer. Through an approved private
transport, a person can issue `handoff` and then coordinate clicks, keyboard
presses or text insertion on the actual retained page. No public CDP or HTTP
endpoint is introduced. Do not disable the viewer's read-only setting.

```sh
python3 /app/shared/skills/apply_assisted.py handoff --position-id "$PID"
# Synthetic example; send actual private input through stdin, never argv/logs.
printf '%s\n' '{"action":"press","key":"Tab"}' |
  python3 /app/shared/skills/apply_assisted.py input --position-id "$PID"
```

Input supports `click` with x/y coordinates, `type` with text, and `press` with
a Playwright key. It does not expose evaluation, arbitrary scripts or navigation.
The Unix socket is mode 0600 with private directories; access on a shared UID
does **not** authenticate an operator or grant new authorisation. Official gates
remain required before handoff and every input. This does not resolve #279.

Before granting handoff the owner reserves the cap slot and durably records
`submit_started`. This means **possible human submission**, including Enter or
onchange, rather than a claim that a submit click happened. No automation runs
during handoff. Subsequent resume only observes a confirmation/receipt on the
same page. Without conclusive confirmation it stops as `submit_outcome_unknown`
and never submits again, even if the person only pressed Tab. Thus this minimum
cannot automatically continue filling after arbitrary human input. A person
must complete the authorised portal interaction or leave an unknown outcome.
The cap reservation/checkpoint survive abandon, timeout and disconnect; no
false receipt is created and no uncertain slot is released.

## Cleanup

```sh
python3 /app/shared/skills/apply_assisted.py finish --position-id "$PID"
python3 /app/shared/skills/apply_assisted.py abandon --position-id "$PID"
```

Both close the real Page/context/runtime and release position/profile locks.
The fixed TTL (1–3600 seconds, default 1800), TERM/INT, or detected browser
disconnect also clean up. TTL interrupts initial navigation as well as the
controller wait. SIGKILL relies on OS process cleanup and lock release; it cannot
run Python cleanup. Starting another flow on the same position fails busy;
different flow instances in the same thread are also excluded.

## Reproduce without sending an application

Run from the shared-machine compilation turn using Python with pytest and
Playwright 1.61.0 plus its installed Chromium:

```sh
python -m pytest tests/test_apply_assisted.py -q
```

Fixtures use local HTML and synthetic data in temporary homes. They verify
retained Page/context/cookies, official answer resume, real manual-submit
triggers and unknown recovery, real Chromium/profile cleanup, normal automatic
cleanup, and an isolated owner subprocess with real signal timer during both
navigation and idle. They never connect to a vacancy or use real product data.
Independent `test_apply_assisted_negative.py` covers gates, locks and controller
negative cases with an instrumented inert browser; those are not Chromium proof.
Native macOS ARM evidence does not establish Linux AMD64 runtime behaviour.

Package the delta on the immutable baseline image and validate an isolated VPS
fixture without mounting the real home before promotion. Preserve the original
container/image for reproducing prior behaviour and rollback. Container rollout
and private viewer transport belong to the reviewed deployment procedure.
