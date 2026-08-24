# Desktop setup modes

**Decision date:** 2026-08-24
**Implementation status:** only `own PC + own API key` is active

## Purpose

The desktop setup chooses two independent things:

1. where the agent containers run;
2. how the AI agents authenticate and who pays the provider consumption.

Keeping these dimensions separate prevents UI choices from leaking into agent
policy. Every mode ultimately connects the desktop to the same versioned
product/control API.

## Supported target modes

| Product setup | Execution host | AI authentication/runtime | Customer supplies | Commercial relationship |
|---|---|---|---|---|
| **Managed plug and play** | JHT-managed VPS | JHT-managed API credentials; headless API agents | Stripe payment method only | Customer buys JHT credits; JHT pays VPS and provider consumption |
| **Own VPS + provider subscription** | Customer VPS, containers on the VPS | Provider TUI agents inside `tmux` | VPS IP, SSH private key, personal provider subscription/login | Customer pays VPS and provider subscription |
| **Own VPS + own API key** | Customer VPS, containers on the VPS | Node.js headless agent image | VPS IP, SSH private key, personal API key | Customer pays VPS and metered provider usage |
| **Own PC + provider subscription** | Customer PC, local containers | Provider TUI agents inside `tmux` | Personal provider subscription/login | Customer pays provider subscription |
| **Own PC + own API key** | Customer PC, local Podman containers | Node.js headless agent image | Personal API key | Customer pays metered provider usage |

For an own PC setup, IP address and SSH key are unnecessary. For an own VPS,
the desktop uses the supplied IP and SSH key to provision the containers and to
reach the versioned API through the remote transport.

## Slice being built now

The active onboarding path is:

```text
own PC
  -> Podman
  -> Node.js headless API agents
  -> user's OpenAI API key
```

The active vertical slice checks the local Podman engine, initializes its
machine when required, builds the bundled headless worker image and runs a
budget-capped full-team test against checked-in synthetic data. The API key is
cleared from React state on submit, crosses the Tauri boundary for that run,
enters Podman over standard input as a temporary secret and is removed when the
run finishes. It is not written to renderer storage, plain files, command-line
arguments, image layers or logs.

This slice intentionally does not remember credentials. A future remembered-key
flow must use an audited operating-system credential store at the native
boundary; it must never use localStorage, plain files, logs or renderer-side
configuration.

## Deferred UI and implementation

- Managed plug-and-play checkout, Stripe credit balance and consumption ledger.
- Own-VPS IP/key validation, host-key verification, provisioning and tunnel
  lifecycle.
- Provider-subscription selection, TUI image build and `tmux` login flow.
- Automatic Podman installation and recovery beyond machine initialization.
- Native credential storage and remembered-key revocation/replacement.

These options remain documentation-only until their vertical slice is started.
