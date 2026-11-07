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
