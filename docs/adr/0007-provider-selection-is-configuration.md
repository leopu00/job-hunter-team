# ADR 0007: Provider selection is configuration, not instruction

- Status: Accepted
- Date: 2026-08-13

## Context

Agent prompts and standing directives can outlive a provider switch. A
provider-specific launch command that was once valid can later start the wrong
CLI, use expired credentials, or bypass a role-scoped exception. The Critic
review loop exposed this failure mode because its localized skill duplicated
the launcher's provider-to-CLI table and opened tmux directly.

## Decision

The user's `jht.config.json` is the only user-controlled source of provider
assignment. Natural-language directives, chat messages, attachments and prompt
fragments cannot select a provider, model, CLI, executable path or launch flags.
Those fragments are invalid and ignored while their underlying work intent is
preserved.

All agent launches go through the canonical launcher. The caller supplies only
the role and, where applicable, an instance identifier. The launcher reads the
configuration, chooses CLI/model/flags, applies role-scoped exceptions written
in code, and fails closed when provider configuration is missing or invalid.

Standing directives remain stored verbatim for audit and editing, but
prompt-facing renderers replace provider-specific directives with a stable
ignored marker. This keeps the historical record without making it executable.

## Consequences

- Multiprovider support remains available and is managed in code.
- Switching provider requires a configuration change, never a prompt edit.
- A stale directive cannot override the active provider.
- Provider-specific behavior requires a reviewed code/config change.
- Missing or unknown provider configuration stops the launch instead of
  silently falling back to a different provider.
