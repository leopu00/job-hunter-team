# ❓ FAQ — is this project for me?

Six questions worth answering before you install anything. Each answer states
what the code does today; where a detail lives in one canonical place, this
page links it instead of repeating it.

---

## What is Job Hunter Team, and what is it not?

**It is** a team of AI agents that runs your job search continuously on a
machine you control: a Scout finds positions, an Analyst verifies them, a
Scorer ranks them 0–100 against your profile, a Writer drafts a tailored CV and
cover letter, a Critic blind-reviews them, and a Captain orchestrates the whole
thing inside a budget. State lives in a local SQLite database with a
job-search data model — `positions`, `companies`, `scores`, `applications`,
`position_tickets` (see `shared/skills/_db.py`).

**It is not an auto-applier.** Nothing in the codebase submits an application,
fills a form or answers a recruiter for you. Drafts are written to
`~/Documents/Job Hunter Team/output`; the `applications` table records
`applied`, `applied_at` and `applied_via` **after you tell it you applied**.
The team's output is a shortlist and a set of documents — the send button
stays yours.

It is also not a bulk board scraper. A Scout processes **one position per
iteration** through dedup, link verification, job-description fetch and filter
gates, and mass-ingesting a board in one shot is explicitly forbidden, because
skipping the per-position gates fills the database with data the Analyst then
burns budget cleaning (`agents/scout/scout.md`, rules SC-01 to SC-09).
LinkedIn is reached through an authenticated access path rather than the
generic fetch tool. This is not a robots.txt-compliant crawler in the general
case, and if that distinction matters to you, read those rules before
installing.

## Do I need Docker?

For the supported setup, yes. The default install puts nothing on your host
except Docker itself: the Node CLI, Python, tmux and every agent run inside
one long-running container (`scripts/install.sh`). An expert `--no-docker`
native mode exists in the installer, but the container is the path that gets
tested and documented.

On macOS you choose the runtime — Colima (default, headless) or your own
Docker Desktop — and an already-running Docker is reused rather than replaced
([ADR-0006](../adr/0006-user-choice-container-runtime-macos.md)).

## What does it cost to run, and what drives the cost?

Three separate things, only one of which JHT influences:

1. **An AI-provider subscription**, dedicated to the team — JHT does not
   include or resell it. Agents are launched as provider CLI sessions
   authenticated with your own account, which is the decision recorded in
   [ADR-0004](../adr/0004-subscription-only-no-api-keys.md). One caveat, stated
   rather than smoothed over: the configuration schema still accepts an
   `api_key` authentication method and the setup wizard still writes it, but
   the launcher path starts the provider CLI. Treat pay-per-use as unsupported
   for running the team, not as a second tested mode. Current plans and
   measured consumption per provider: [`PROVIDERS.md`](PROVIDERS.md).
2. **A host**: your own PC costs you power, a VPS costs its monthly fee. The
   trade-offs, without price quotes that go stale:
   [`CHOOSE-WHERE-TO-RUN.md`](../guides/CHOOSE-WHERE-TO-RUN.md).
3. **Nothing for the software** — MIT.

What drives consumption is the plan's own cap, not the number of agents. The
team measures its real weekly burn rate against a sustainable one and steers
itself: `shared/skills/weekly_pace.py` computes the rate, the Sentinel turns it
into orders, the Captain scales workers up or down. Running more agents inside
the same subscription mostly means more work done per window, not a larger
bill — the cap is the ceiling either way.

Hardware is the one requirement that bites: below 8 GB of RAM the host setup
warns that the team may run out of memory and offers to configure swap
(`scripts/host-setup.sh`).

A local model does not remove the subscription. The one experimental path is
the Scorer, and its safe default only shadows the real one without writing
results ([`LOCAL-SCORER.md`](../guides/LOCAL-SCORER.md)); every other role still
goes through the configured provider.

## Where do the agents run, and where does my data go?

The agents run as provider CLI sessions inside the container, in tmux, logged
in with your own provider account (`.launcher/start-agent.sh`). The container
publishes **no network port**, has **no Docker socket**, and sees exactly two
folders of your filesystem — `~/.jht` and `~/Documents/Job Hunter Team`. The
rest of the disk is invisible to it (`docker-compose.yml`).

What leaves the machine, and only that:

| Destination | When | What |
|---|---|---|
| Your AI provider | Always — it is how the agents think | Prompts, and the profile or job-description context a role needs |
| Job boards and career pages | Always — it is how positions are found | Ordinary web requests |
| The cloud dashboard | **Only if you enable it** | Mirrored positions, scores and applications, plus the candidate profile file (capped at 64 KB) |
| Telegram | **Only if you configure a bot** | Notifications, and the messages you send back as commands |

Cloud sync is off until you turn it on, and there are three ways to do that
(`cli/src/commands/cloud.js`): `jht cloud login` pairs the CLI with your browser
session and the server issues the token once you approve — no manual paste;
`jht cloud enable --token …` takes a token you generated yourself on the site;
and `jht cloud pair` is the non-interactive path, used automatically on a VPS's
first boot when provisioning left a pairing token behind. Until one of them
runs, every cloud command answers *"Cloud not configured"*.

Your CV and cover-letter files stay on the host: the browser reaches them
through an on-demand bridge, not a permanent upload.

Secrets never sync: `~/.jht/secrets.json` — VPS tokens, SSH keys — is
local-only by design.

The hosted dashboard is not a control panel, but it is worth being precise
about *why*, because two different mechanisms are at work. Control and
configuration writes that go through the shared write-guard are refused with a
403 decided at build time, not inferred from the request headers
(`web/lib/auth.ts`). The declared exceptions are the light position actions —
like/dislike, tickets, recheck or rewrite requests, excluding a position, notes
and marking one as applied — plus the emergency stop and account deletion,
which have to work from a browser by definition. Everything else that mutates
the team is unreachable on the cloud because that environment simply is not
there: no tmux, no team filesystem. That is a real limit, but it is a different
guarantee from a gate that says no, and it is worth knowing which one you are
relying on.

## How is this different from a general-purpose agent framework?

A framework gives you primitives to build an agent system. JHT is one already
built for a single job, and the constraints are the product:

- **Fixed roles with fixed boundaries.** Each agent keeps a small context on
  purpose. Blind review only means something if the Critic has not seen the
  Writer's reasoning.
- **One writer at a time.** The team runs in one location — VPS or PC, never
  both ([ADR-0003](../adr/0003-single-writer-team.md)).
- **A budget watchdog with authority.** The pacing loop is not a token counter
  in a log: it measures rate against sustainable rate and produces orders that
  throttle, scale or stop workers.
- **Exactly three provider CLIs**, at versions pinned in
  `shared/config/provider-versions.json`, so two machines on the same release
  run the same runtime ([ADR-0002](../adr/0002-three-supported-agent-clis.md)).
- **A domain schema, not a transcript.** Positions, scores and applications are
  rows you can query, feed back into and correct — which is what makes
  scoring improvable over weeks.

If you want to compose your own agents, a framework is the right tool. If you
want a job search running unattended tonight, this is a finished system with
opinions.

## Can I use it without a VPS?

Yes, and it is the recommended starting point. The local-PC path is a
first-class supported runtime: the desktop application drives the container on
your own machine directly, no SSH involved. The trade is that your computer has
to be on for the team to work.

A VPS buys one thing — the team keeps running with every computer of yours
switched off. A third path, a dedicated Linux PC on your LAN, works over the
existing SSH transport but is an advanced topology rather than a guided flow.
Full comparison, including what moving later involves:
[`CHOOSE-WHERE-TO-RUN.md`](../guides/CHOOSE-WHERE-TO-RUN.md).

---

> Something here out of date, or a question this page should answer and does
> not? Open an issue — a wrong FAQ costs more than a missing one.
