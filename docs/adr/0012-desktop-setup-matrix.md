# 0012 — Separate execution host from AI authentication in desktop setup

**Status:** Accepted  
**Date:** 2026-08-24  
**Supersedes:** [ADR-0004](./0004-subscription-only-no-api-keys.md)

## Context

ADR-0004 made provider subscriptions and interactive TUI agents the only normal
product path. The new Node.js headless agent runtime uses provider APIs instead,
and the desktop product now needs to serve managed customers, customer-owned
VPS hosts and customer-owned PCs without conflating infrastructure ownership
with AI billing.

## Decision

1. Desktop setup treats **execution host** and **AI authentication/runtime** as
   independent dimensions.
2. The execution host is one of: JHT-managed VPS, customer VPS, or customer PC.
   Own-VPS setup requires IP address and SSH key; own-PC setup does not.
3. A customer's provider subscription selects the interactive TUI agent image
   with persistent `tmux` sessions.
4. A customer-supplied API key selects the Node.js headless agent image. The
   customer pays the provider's metered usage.
5. Managed plug-and-play uses a JHT-managed VPS and JHT-managed API credentials.
   The customer connects a payment method through Stripe and buys platform
   credits; JHT pays the infrastructure and provider consumption.
6. The first implemented desktop path is customer PC + local Podman containers
   + customer OpenAI API key + Node.js headless agents.
7. API credentials cross the native boundary into an audited operating-system
   credential store. They are never persisted in renderer storage, plain-text
   configuration or logs.

The full mode table and staged implementation scope are in
[`2026-08-24-desktop-setup-modes.md`](../internal/architecture/2026-08-24-desktop-setup-modes.md).

## Consequences

- Subscription-backed TUI teams remain a supported option, not the universal
  runtime.
- API usage needs explicit budget visibility and guardrails; the flat-rate
  assumptions from ADR-0004 cannot be applied to headless workers.
- Host provisioning and provider authentication can evolve independently while
  every mode still exposes the same versioned product/control API.
- The setup UI can grow gradually without encoding a different agent protocol
  for local and remote hosts.
- Managed credits add payment, balance and consumption-ledger responsibilities
  before that mode can ship.

## Alternatives considered

- **Keep subscription-only onboarding.** Rejected because it cannot run the new
  headless API workers or the managed-credit product.
- **Make API keys the only runtime.** Rejected because customer-owned provider
  subscriptions and their TUI/`tmux` runtime remain a supported setup.
- **Create one bespoke flow per host/runtime combination.** Rejected because it
  duplicates transport and provisioning rules and makes later options harder to
  compose safely.
