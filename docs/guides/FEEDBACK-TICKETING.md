# 💬 Feedback Ticketing

Operational runbook for the `/api/feedback` endpoint and the surfaces that post to it.

> 🧪 This is the operational side of the public testing and feedback channels
> documented in [`docs/guides/BETA.md`](./BETA.md).

## 🚪 Where users actually report

There is **no `/feedback` page**: three surfaces post to `POST /api/feedback`:

- **Signed-in web app** — the avatar menu opens **"Report a problem"**. It sends only the subject, account-free description and the current route previewed to the user; `client: "web-dashboard"`.
- **Public web form** — `/contact`, for people who are not signed in or have not installed the app; `client: "web-contact"`.
- **Godot office** — the `FeedbackService` autoload ([`game/scripts/support/feedback_service.gd`](../../game/scripts/support/feedback_service.gd)), behind **System → "Report a problem"** and a second diagnostics entry. It is the only surface that attaches diagnostics and it writes a local copy under `user://reports` before attempting the network. `JHT_FEEDBACK_URL` overrides the endpoint.

Browser-side coverage of the two web surfaces: [`e2e/tests/82-support-report.spec.ts`](../../e2e/tests/82-support-report.spec.ts).

## 🔒 What is collected — and what is not

The endpoint accepts only known client, platform, locale and message-category values. It re-runs the full personal-data and secret redactor over every free-text field, including diagnostics, before mail, issue or webhook delivery. It drops `contact` even when a pre-release client still sends it.

The report may contain the app version, platform, UI locale, a user-written problem description, the user-approved diagnostic preview, and a ticket reference. It does **not** transmit email addresses, phone numbers, names from known local onboarding data, document/CV names, home paths, public IPs, tokens, API keys, passwords, SSH keys or arbitrary metadata. The UI must show the exact outgoing preview and its redaction count before send.

## 📬 Delivery and truthfulness

`RESEND_API_KEY` plus `JHT_FEEDBACK_TO` (or `JHT_SUPPORT_EMAIL`) configure the primary private inbox. GitHub issues and a webhook are optional secondary channels. `web-*` reports never create public GitHub issues.

`200 {"ok":true,"ticket":"JHT-…"}` means at least one configured destination accepted the report. `400`, `413`, `429`, `503` or a network error mean it was **not** delivered; the desktop client keeps its local copy and must say so. Never display a success confirmation before this response.

## 🚢 Deploy

Production deploy:

```bash
git checkout production
git pull --ff-only
git merge --ff-only <branch-to-release>
git push origin production
```

Notes:

- the live site must go through a push to `production`, not `vercel deploy --prod` from local branches;
- create the release tag only after Vercel's Git deploy on `production` reports `READY`.

## ✅ Verification

Quick smoke test:

```bash
curl -i https://jobhunterteam.ai/api/feedback
# Harmless reachability probe: the `website` honeypot answers without delivery
# and does not consume one of the five real reports allowed per hour.
curl -i -X POST https://jobhunterteam.ai/api/feedback \
  -H 'content-type: application/json' \
  --data '{"client":"probe","happened":"probe report","website":"bot"}'
```

Expected:

- the probe must return `200` with `{"ok":true,"ticket":"JHT-…"}`
- this proves the public route is reachable, **not** that the inbox is configured

For a delivery E2E, send exactly one synthetic `web-contact` report with no personal data and confirm `200`; this client never opens a public issue. The endpoint accepts **5 real submissions per hour per IP** — beyond that it answers `429` with `Retry-After`. A body without `happened` (min 5 chars) is a `400`, not a channel failure.

## 📝 Operational notes

- A missing delivery configuration deliberately returns `503`: a false "sent" confirmation is worse than an honest local failure.
- The release checklist must verify a monitored private inbox before release; source code and a honeypot probe cannot prove mailbox configuration.

## 📚 Related

- 🧪 [`docs/guides/BETA.md`](./BETA.md) — public testing and feedback channels
- 🔒 [`docs/internal/ops/MAINTAINERS.md`](../internal/ops/MAINTAINERS.md) — Supabase access and Vercel env vars
- 🚢 [`docs/internal/ops/release.md`](../internal/ops/release.md) — full release flow
