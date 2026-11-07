# Managed Codex launch configuration

The worker launcher and the doctor/maintainer REPL share the argument builder
`shared/skills/codex_launch_policy.py`. It preserves the selected model, effort,
document budget and existing approval policy, and supplies two configuration
overrides. It does not update the CLI, change models, or grant new access.

Compatibility evidence for the product pin, **rust-v0.147.0**:

- [Config schema](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/core/config.schema.json):
  `definitions.Notice.properties.hide_rate_limit_model_nudge.type` is `boolean`;
  `properties.check_for_update_on_startup.type` is `boolean`.
- [Update implementation](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/tui/src/updates.rs#L151):
  `get_upgrade_version_for_popup` returns no upgrade when the update check is
  disabled. The corresponding startup check is also at line28.
- [Config loading](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/core/src/config/mod.rs#L3949):
  the parsed update boolean is loaded, with true as its default.

These are supported configuration keys in the pinned release, passed through
the existing `-c` option, rather than new command-line flags that an older parser
could reject. The fake CLI tests check actual emitted arguments; they do not
replace verification of the vendor's pinned schema.

The overrides suppress the model-switch reminder and the startup update check.
They do not bypass a real usage limit, login failure, unknown dialog or missing
model. Those need a separate visible, bounded recovery policy.

## Live reminder recovery

The container watchdog delegates to `codex_dialog.py` before its normal agent
maintenance. The REPL kickoff delegates to `spawn_kickoff.py`: other providers
retain their previous cadence; Codex receives no blind startup Enter. After
recovery, its work prompt goes through the existing verified sender only when
the live pane still shows an empty composer. The normal sender's menu guards
remain in force. Sender deadlines use the existing non-destructive runner.

The recovery recognizes the complete English reminder at the bottom of the
visible pane, its selected option and confirmation hint. It moves the selection
to the exact `Keep current model` label, even when option order changes. It does
not choose a model or the separate `never show again` option. It checks the pane
identity and menu again before each move and confirmation, then waits at most
four seconds for a composer or work to return; each tmux command has a separate
five-second bound. There is one confirmation per unresolved episode. Terminal
redraws, wrapped or unknown dialogs are refused rather than guessed.

State is per session **and pane** under `$JHT_HOME/state/codex-dialogs`, with
hashed filenames, nonblocking locks, bounded regular-file reads and atomic
writes. An invalid state does not reset the attempt. A confirmed return to a
composer rearms a later reminder. `pane_id`, `pane_pid` and the current command
guard the same pane; `pane_pid` identifies the tmux shell, not an attested CLI
child process. This is a cooperative recovery lock, not a lock against a person
typing in the terminal at the same instant.

Fixed catalog codes and phrases are written to `runtime.log`, without captured
screen text. The coordinator receives a separate `[CODEX-DIALOG]` state; failed
notifications are logged and limited to three attempts per state. A read-only
`status SESSION` command reports the current pane's last observation and time.
After manual resolution the state is `codex_dialog_ready`, without claiming an
automatic recovery. The coordinator skill requires reporting the dialog before
manual recovery or replacement; the seven role prompts point to it only for
the terminal CLI, excluding the API harness. This is a prompt instruction,
not proof of a language model's future decision.

Stopped teams, valid standby and paused agents receive no recovery input.
Only known product session names with a current `codex` command are inspected.
Unknown model, login, trust and update dialogs are reported without accepting
them. A true quota limit still needs diagnosis. Future vendor layouts are not
promised to be auto-recoverable.

## Synthetic measurement

On a local serial sample of 100 argument constructions, through the build queue,
the original launcher assignment at the baseline took 0.01 seconds total and
the shared Python builder took 2.13 seconds total (approximately 0.1 versus
21.3 milliseconds per launch). This is the cost of one interpreter startup for
the common policy. No provider CLI or network was started; these numbers do not
measure real agent startup, recovery on a live TUI, or production throughput.
