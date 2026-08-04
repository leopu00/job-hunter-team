# 🧪 Testing and feedback

JHT is publicly available. This page explains how to report a problem and how
to contribute reproducible evidence after running it; there is no application
or invitation-only access process.

## Before reporting a problem

1. Run `jht doctor` if you installed the CLI, or open **System → Diagnostics**
   in the native office.
2. Confirm which JHT version and operating system you are using.
3. Reproduce the smallest failing flow you can.
4. Remove personal data from screenshots and text. Never attach a CV, provider
   credential, machine address or account token.

From the office, use **System → Report a problem**. The diagnostics bundle is
redacted and shown before it is attached. From the web app, use **Report a
problem** in the account menu; without an account, use the
[/contact](https://jobhunterteam.ai/contact) form. A GitHub
[bug report](https://github.com/leopu00/job-hunter-team/issues/new?template=bug_report.md)
is also available for reports that are safe to discuss publicly.

Security vulnerabilities follow the private process in
[`SECURITY.md`](../../SECURITY.md), never a public issue.

## What is stable

- The agent pipeline runs end to end on Claude and Codex subscriptions.
- Codex has completed a one-month autonomous run; the data and method are in
  [`RESULTS.md`](../about/RESULTS.md).
- The native office contains local and VPS setup, embedded provider login,
  profile, email, Telegram, cloud sync, positions and agent observability.
- The CLI, native office, web dashboard and Telegram share the same
  container-backed team.

Provider status is not uniform. Kimi's lower-cost tier remains under
observation because its usage projection varies more than Claude or Codex.
That provider-specific limitation is documented in
[`PROVIDERS.md`](../about/PROVIDERS.md) and
[`MONITORING.md`](../about/MONITORING.md).

## Sharing run evidence

Case studies are useful only when success and failure are reported together.
If you publish a run, include:

- operating duration and provider plan;
- positions found, checked, scored and made ready;
- rate-limit or monitoring incidents;
- the amount of user intervention;
- the JHT version and relevant configuration choices;
- an explanation of how personal and employer data were anonymized.

Do not publish raw databases, CVs, chat logs, credentials or infrastructure
details. The current case studies and their schema are in
[`RESULTS.md`](../about/RESULTS.md).

## Related

- [`QUICKSTART.md`](QUICKSTART.md) — installation and first run
- [`FEEDBACK-TICKETING.md`](FEEDBACK-TICKETING.md) — maintainer-side routing
- [`RESULTS.md`](../about/RESULTS.md) — published evidence
- [`SECURITY.md`](../../SECURITY.md) — private vulnerability reporting
