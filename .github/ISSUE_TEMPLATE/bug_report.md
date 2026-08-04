---
name: Bug report
about: Report a problem with JHT
labels: bug, triage
---

<!-- 
Thanks for taking the time to file a bug. The questions below are the
minimum we need to triage without a back-and-forth round trip. If a
field doesn't apply, write "n/a" — please don't delete the section.

Before opening: search existing issues for the same symptom.
-->

## What happened

<!-- One paragraph. What did you see vs. what did you expect? -->

## How to reproduce

1. 
2. 
3. 

## Environment

- **Install path:** [ native Godot app / CLI one-liner / source clone / VPS ]
- **OS:** macOS / Linux / Windows (version + arch)
- **JHT version or commit:** <!-- output of `jht --version` or `git log -1 --oneline` -->
- **Docker:** running? version? Colima / Docker Desktop / native?
- **Provider in use:** Claude Max / Kimi K2 / Codex (and which agent role hit the bug, if relevant)
- **Browser** (only if the bug is in the web UI): name + version

## Logs

<!--
Paste the relevant lines. Useful sources, in order:
- container logs: `jht logs --tail 200` or `docker logs --tail 200 jht`
- agent pane: `tmux capture-pane -t <SESSION> -p -S -200`
- sentinel state: `jht sentinella status` and `jht sentinella tail`
- web/Next.js: browser DevTools console + Network tab
Before pasting, remove names, email addresses, CV/application content,
machine addresses, hostnames, account identifiers and tokens. Never upload a
raw database, configuration file or credential store to this public issue.
Wrap large blocks in ```...``` so they fold.
-->

```text

```

## Screenshots

<!--
Drag & drop here if the bug is visual. Skip otherwise. Crop or redact the same
private data listed above before uploading to this public repository.
-->

## What you already tried

<!--
e.g. "ran `jht doctor`", "wiped ~/.jht and re-ran setup",
"restarted the container". Helps us avoid re-suggesting the obvious.
-->

## Severity (your call, we may relabel)

- [ ] Blocks me completely (no workaround)
- [ ] Painful but I have a workaround
- [ ] Cosmetic or minor

<!--
Once submitted, expect a triage label within ~48h (see
docs/internal/ops/triage.md for the contract). No fix SLA is promised.
-->
