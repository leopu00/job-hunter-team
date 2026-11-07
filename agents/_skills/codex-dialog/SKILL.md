---
name: codex-dialog
description: Distinguish a managed Codex CLI dialog from a dead worker before recovery or replacement.
---

Use this only for agents running the **Codex terminal CLI**, not the API harness.
A `[CODEX-DIALOG]` notification is a separate lifecycle state, not evidence that
the worker died. The watchdog recognizes the live model reminder, keeps the
current model, and reports whether recovery succeeded. It never replaces the
session, accepts trust requests, changes models, updates the CLI or grants access.

Read the last recorded observation without sending input:

```bash
python3 /app/shared/skills/codex_dialog.py status SCORER-1
```

`last_observation` and `at` describe the last check, not a guarantee of current
liveness. `codex_dialog_recovered` means the same pane returned to a composer
or work; `codex_dialog_ready` records a subsequent healthy observation, without
claiming automatic recovery. `pending`, `timeout`, `changed`, `unrecognized` and `io_error` require
inspection. The complete code names start with `codex_dialog_`.

Report this state to the user before deciding on manual recovery or replacement.
Do not silently clone, kill or replace the worker. For an unresolved dialog, use
the Dottore to diagnose it and explain the proposed action. Never send a blind
Enter or select a suggested model. Ordinary messages still use `tmux-send` and
its readiness checks. A true quota exhaustion, login or trust request is not a
successful model-reminder recovery.
