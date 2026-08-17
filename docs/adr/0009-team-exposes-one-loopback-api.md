# 0009 — The team exposes one loopback API; every client is thin

**Status:** Proposed
**Date:** 2026-08-17
**Revisits:** commit `303a6ec604` (2026-07-23, retirement of the local web dashboard) — which has no ADR of its own
**Refines:** [`2026-06-20-data-sync-and-dashboard-split-design.md`](../internal/architecture/2026-06-20-data-sync-and-dashboard-split-design.md) § the three planes

## Context

JHT has four clients — the Godot app, the web app, the CLI, and an untracked TUI
sitting on disk — and the number of places a team can run keeps growing: the
user's PC, a VPS, and `[JHT-DESKTOP-06]` adds a computer on the LAN. Written as a
matrix of *(where the team runs × which client I use)*, every new entry costs work
in every client, in a different language each time.

**That matrix has already been collapsed once, on paper.** `web/lib/deploy-mode.ts`
is the record: `'local'` means *"container **CO-LOCATO** col team: PC dell'utente
dentro l'app desktop, **oppure VPS via tunnel SSH** […] La STESSA immagine Docker
vale per PC e VPS: entrambi sono co-locati → entrambi 'local'."* PC and VPS are not
two cases. They are one case with a tunnel in the middle. Two data modes, not six.

**The collapse is not in force, because the boundary it needs no longer exists.**
On 2026-07-23, commit `303a6ec604` retired the local web dashboard for a reason
that still holds: *"il container continuava a servire la Next.js su
127.0.0.1:3000 e il gioco aveva ancora un pulsante che apriva il browser sulla
landing con Sign in — residui fuorvianti. Il browser è solo cloud."* What it
removed, correctly, was a **browser-facing dashboard**. What it removed as
collateral was **any API boundary on the container**: `EXPOSE 3000` went, compose
publishes no ports, and the Dockerfile records that `web/` is not installed because
Next/React/eslint/tailwind were *"peso morto"*.

With no boundary, each client wrote its own transport. Measured 2026-08-17:

- **`game/scripts/backend/` — 3,929 LOC of GDScript** implementing the matrix by
  location: `local_backend.gd` over `docker exec`, `vps_backend.gd` with **62**
  ssh/tunnel references.
- **`web/` — 142,437 LOC of tsx**, 97 API routes, `local-queries.ts` (1,840 LOC)
  and `team-directives-local.ts` (225) written *for* the co-located case and
  deployed only in the `cloud` one.
- **`cli/` — 21,020 LOC of JS** with its own paths to the same data.
- **The co-located case has no live channel at all.** Realtime is a websocket
  *direct* browser↔Supabase; `useChatLaneLive.ts` states that in local mode the
  client is a mock without `channel`, so the hook returns `null` by design.

The interaction plane — chat, upload, start/stop, config — is the one the design
doc assigns to the desktop app exclusively. It is also the only plane that needs
two-way traffic with the box, and the only one implemented three times.

## Decision

1. **The team's container exposes exactly one API, bound to loopback.** An API,
   not a dashboard: no HTML, no browser entry point, and nothing anywhere that
   opens a browser at it. The 2026-07-23 retirement **stays in force** — what is
   restored is a contract, not a page.

2. **Transport is the client's problem, and the API must not be able to tell the
   difference.** Loopback when the box is this machine; the same loopback through
   an SSH tunnel when the box is a VPS or a LAN computer. This is what turns
   `[JHT-DESKTOP-06]` into a host entry instead of a fourth backend.

3. **Auth is the local token that already exists** — `~/.jht/.local-token`, 32
   random bytes, `Authorization: Bearer`. `web/lib/local-token.ts` already reserves
   its cookie branch for exactly this consumer (*"il giorno che un setter lato Node
   servirà (browser del desktop nativo) è lì pronto; finché non nasce, è inerte"*)
   and guards the reservation with `tests/js/tasks/local-token-cookie-claim.test.ts`.
   Whoever activates that branch updates that comment — the test exists to force it.

4. **No Next, React, eslint or tailwind in the image.** The weight argument behind
   the retirement is not overturned. The server carries route handlers and
   `web/lib/`, and nothing that renders. Which shape — Next standalone output, or a
   minimal server (Hono/Fastify) reusing `web/lib/` — is settled **by measuring the
   image delta**, not by preference. Node costs nothing new: the base image is
   already `node:22-bookworm-slim` and the build already runs `npm ci --prefix cli`.
   The dependency tree is the entire question.

5. **A client that keeps a private transport is not done.** Which client goes first
   is a choice of proof, not of scope: the CLI is the cheapest (already Node,
   already on the box), the desktop shell is the target. Whichever goes first, its
   old path is **deleted**, not parked beside the new one.

6. **This ADR does not choose a UI framework.** What renders the clients stays
   open. The point of the boundary is that the answer stops being load-bearing.

## Consequences

**What this buys**

- One implementation of every read and every write. `local-queries.ts` stops being
  code written for a mode nothing runs.
- A live channel becomes *possible* where today there is none. SSE over the same
  tunnel is the cheaper thing to try first; a websocket through SSH also works and
  costs more.
- `[JHT-DESKTOP-06]` becomes a host plus a tunnel.
- The CLI shrinks instead of growing, and the Godot app can drop 3,929 LOC of
  transport **regardless** of what is decided about its UI.

**What this makes harder — to be designed, not discovered**

- **The API becomes a versioned contract.** Today the desktop app and the image
  update on separate tracks and `docker exec` tolerates the skew loosely. Over
  HTTP, skew is a wire mismatch — the failure class
  `[CHAT-LANE-SILENT-DROP-ON-OLD-CLIENT]` already produced once. A version
  handshake belongs to the first slice, not to later hardening.
- **A loopback port is a new surface** on a box that publishes none today. Bind
  `127.0.0.1` explicitly — never `0.0.0.0` — bearer on every route, no CORS, and
  no `ports:` in compose: reachable through the tunnel, never from the network.
- **pid1 gains a child to supervise.** The retirement deliberately unhooked pid1's
  keep-alive from the dashboard child; it is now an explicit
  `setInterval(() => {}, 2 ** 31 - 1)` at `cli/src/commands/pid1.js:1186`. A server
  child must not become the keep-alive anchor again.
- **The tunnel becomes load-bearing for correctness**, not just convenience: a
  dropped tunnel is indistinguishable from a stopped team unless the client says
  otherwise. The open row on friendly error handling stops being cosmetic.

⚠️ **Nothing here is verified against a running server, and the proof needs
Windows** — the tunnel, the loopback bind and WSL2's networking are exactly where
this breaks, and there has been no Windows bench since 2026-08-11 (`BACKLOG.md`).
Same blocker as [ADR-0008](./0008-podman-evaluated-behind-a-shim.md).

## Alternatives considered

- **Extract a shared transport library instead of an API.** Rejected: the library
  would have to exist three times — GDScript, TS, JS — because the clients share no
  runtime. That is today's duplication with a better name.
- **Put the API in Python, beside the agents.** Not rejected — deferred. The agents
  are Python (9,901 LOC) and the runtime is present, but the 90% that already
  exists (97 route handlers, `local-queries.ts`, `team-directives-local.ts`) is
  TypeScript. Choosing Python means rewriting the very part whose existence makes
  this cheap.
- **Route everything through the cloud**, so every client speaks Supabase only.
  Rejected: the interaction plane needs the box, and it would push local data (CVs,
  attachments) through the cloud, against the standing rule that the cloud holds
  index and metadata only.
- **Keep per-client transports.** This is the status quo, and its price is the
  measurement above: every new location multiplied by every client, in four
  languages.

Full analysis, phases and open measurements:
[`2026-08-17-ticket-team-api-boundary.md`](../internal/roadmap/2026-08-17-ticket-team-api-boundary.md).
