# Privacy and Terms copy — pre-release draft

> **Status: operator and legal review required.** This is product-copy work, not
> legal advice and not a claim that Job Hunter Team complies with any particular
> law. Text in square brackets is deliberately unresolved. Do not publish it as
> final copy until every blocker in [Operator decisions](#operator-decisions)
> has an owner and an answer.

This document is the English source of truth for the web and desktop legal
surfaces. Translations must preserve the meaning and the document version; they
must not fill unresolved legal choices independently.

## Release metadata

Use separate, immutable identifiers even when both documents change together:

| Document | Draft version | Visible last updated | Effective date |
|---|---|---|---|
| Privacy Policy | `2026-08-07-draft.1` | 7 August 2026 | `[OPERATOR DECISION REQUIRED]` |
| Terms of Service | `2026-08-07-draft.1` | 7 August 2026 | `[OPERATOR DECISION REQUIRED]` |

The published version must show its version and last-updated date. Acceptance
records must store the exact Terms version, Privacy version, timestamp, and
surface. A new date alone does not prove that a user accepted changed terms.

## Implementation-ready microcopy, subject to operator approval

### Google sign-in

> By continuing with Google, you agree to the [Terms of Service](/terms) and
> acknowledge the [Privacy Policy](/privacy).

Use **agree** for the Terms and **acknowledge** for the Privacy Policy. Both
links must be usable before the user starts Google authentication.

### Desktop bug-report confirmation

> Your redacted report may be published as a public GitHub issue, visible to
> anyone. Review the preview before sending.

This sentence belongs only on a surface whose report can actually reach
GitHub. At source commit `b949dc89b`, `godot-desktop` reports may open a public
issue, while clients whose identifier starts with `web-` do not. The web
Support dialog and `/contact` must not claim that they publish to GitHub unless
that routing is intentionally changed.

### Explicit acceptance control

> I agree to the [Terms of Service](/terms) (version {termsVersion}) and
> acknowledge the [Privacy Policy](/privacy) (version {privacyVersion}).

Use an unchecked control where explicit acceptance is required. A passive
footer link is not an acceptance record.

## Audit result

The pages at `web/app/privacy/page.tsx` and `web/app/terms/page.tsx` are not an
accurate description of the current product. Their April 2026 copy says that
all personal data stays on the user's computer and that Job Hunter Team does
not collect or transmit personal data. That is no longer true when the user
signs in, synchronizes the dashboard, calls an external model provider, uses a
VPS, or submits a support report.

The replacement must cover these distinct processing paths:

| Path | Data and destination | Current product fact |
|---|---|---|
| Local team | Profile, CV-derived data, job research, applications, documents, provider sessions, and work products remain in the user-controlled Docker workspace unless the user enables an outbound feature. | The software runs locally in Docker. “Local-first” does not mean “nothing is ever transmitted.” |
| User-chosen VPS | The same workspace data is stored and processed on infrastructure selected by the user. | The VPS host may process data under the user's separate contract; it is not a Job Hunter Team server merely because JHT runs there. |
| Model provider | Prompts and context needed for the task may include profile or CV content, job descriptions, application materials, agent instructions, and generated work. | The official Claude Code, Codex, or Kimi client sends this material directly to the selected provider under the user's provider account and terms. |
| Desktop utility requests | App-version requests to GitHub, exchange-rate requests to Frankfurter, and map-tile requests to CARTO. | The update check runs at most daily and can be disabled; exchange rates are requested at normal startup; CARTO tiles are requested when the map needs them. These services receive ordinary network request metadata. |
| Google sign-in | Google account identifier, email address, and basic profile information used for authentication. | The client asks Supabase for Google OAuth with no added Google-product scopes. Login does not request Gmail, Drive, Calendar, or Contacts access. Team Gmail is separate, optional configuration. |
| Cloud dashboard | Authentication data and user-selected synchronized profile, job, score, application, message, team-state, preference, device, and file-transfer data. | Supabase is an active authentication, database, realtime, and storage service—not merely a backup. |
| Desktop bug report | User-entered description, app version, locale, operating system, optional redacted diagnostics and logs; rate-limiting request data. | A local Markdown copy is written. The submitted redacted report may go to support email, a configured webhook, and a public GitHub issue. |
| Web contact/support | Message, current page, language, technical request metadata, and rate-limiting data. | Current `web-*` reports go to support email and an optional configured webhook; they do not open GitHub issues. |
| Hosted website telemetry | Aggregate usage and performance measurements, plus ordinary hosting and security logs. | Vercel Analytics and Speed Insights are mounted globally. The present “Necessary only” choice does not disable them and therefore must be fixed or relabelled before release. |

The profile export endpoint currently exports only `candidate_profiles`; it is
not a complete export of all cloud account data. No self-service account and
data deletion flow exists at the audited commit. Public copy must therefore
point to a real, staffed manual process until complete self-service tools ship.

## Privacy Policy — English draft

### Privacy Policy

- **Version:** `2026-08-07-draft.1`
- **Last updated:** 7 August 2026
- **Effective:** `[OPERATOR DECISION REQUIRED]`

Job Hunter Team is local-first software with optional online services. This
policy explains what stays in an environment you control, what leaves that
environment when you choose an online feature, who receives it, and how to
request access, export, correction, or deletion.

This draft describes the product's current technical behavior. It is not a
statement that the product complies with a particular law.

### 1. Who is responsible for your data

`[FULL LEGAL NAME OF THE CONTROLLER]`, at `[REGISTERED OR POSTAL ADDRESS]`, is
the data controller for the hosted Job Hunter Team website, cloud dashboard,
and support channels.

Privacy contact: [support@jobhunterteam.ai](mailto:support@jobhunterteam.ai).

`[OPERATOR DECISION REQUIRED: confirm the legal identity and address, and
confirm that this mailbox is monitored for data-subject requests. If a working
privacy@jobhunterteam.ai alias is created, replace the contact consistently.]`

When you run Job Hunter Team solely on your own computer or on a VPS that you
choose and administer, you control that environment. We do not receive its
contents unless you enable cloud synchronization, use an external provider, or
send a report or support message.

### 2. Data processed locally or on your VPS

The Docker workspace may contain your profile, contact details, CV and
CV-derived structured data, job preferences, researched positions, scores,
applications, generated CVs and cover letters, team messages, settings, logs,
and work products.

When you upload a CV or another onboarding document, the desktop copies it into
the selected runtime's `/jht_user/allegati` directory and passes its path to the
Assistant agent. On a local installation, these files and the local database
remain on your device unless you use a feature that sends specified data
elsewhere. If you run the team on a VPS, the data is copied to and processed on
that VPS under the provider account and terms you selected. You are responsible
for access, security, backups, and deletion on your device or VPS.

### 3. External AI providers

Job Hunter Team uses the official client for the provider you select, such as
Anthropic, OpenAI, or Kimi/Moonshot. The client may send prompts and the context
needed to perform a task to that provider. Depending on the task, that context
may contain profile or CV information, job descriptions, application
materials, agent instructions, and generated work.

Those calls use your provider account and are governed by that provider's
terms, privacy policy, plan, and retention settings. Job Hunter Team does not
resell or bill for those provider accounts. Provider credentials and session
tokens are managed by the provider's client in the environment where your team
runs, which may be your computer or your VPS.

Review the current policies of [Anthropic](https://www.anthropic.com/legal/privacy),
[OpenAI](https://openai.com/policies/privacy-policy/), and
[Kimi](https://www.kimi.com/user/agreement/userprivacy?version=v2) before
choosing a provider.

### 4. Google sign-in

If you continue with Google, Google and our authentication provider, Supabase,
process the information needed to sign you in. This can include your Google
account identifier, email address, email-verification status, name, and profile
image.

Job Hunter Team requests no Google Drive, Gmail, Calendar, Contacts, or other
Google-product access as part of sign-in. Optional Team Gmail access is a
separate feature that you configure separately in the local team; it is not
granted by the Google login used for the dashboard.

### 5. Cloud dashboard and synchronization

If you connect a local or VPS team to the cloud dashboard, Supabase processes
your authentication session and the data you choose to synchronize. Depending
on the features you use, synchronized data can include:

- structured profile and contact information derived from your CV;
- experience, education, skills, languages, work authorization, location, and
  job preferences;
- companies, positions, job descriptions, scores, highlights, application
  status, and feedback;
- team state and history, directives, commands, chat or pending messages,
  onboarding state, views, and notification preferences;
- paired-device identifiers, revocable synchronization tokens, file indexes,
  and files transferred on demand.

Cloud synchronization is optional. Disconnecting a device or revoking its
token stops that device's future synchronization; it does not by itself delete
data already stored in the cloud account.

### 6. Website usage and technical data

The hosted website uses necessary browser storage for authentication, language,
theme, onboarding, and preferences. Hosting and security systems may process
IP address, request headers, page requested, timestamps, and error or abuse
signals to serve the site, protect it, and enforce rate limits.

Vercel Web Analytics and Speed Insights are currently used for aggregate usage
and performance measurements. Depending on the measurement, Vercel may process
the route or URL, browser and device information, operating system, country,
network and performance values, SDK version, and timestamp. See Vercel's
[Web Analytics documentation](https://vercel.com/docs/analytics) and
[Speed Insights privacy information](https://vercel.com/docs/speed-insights/privacy-policy).

`[OPERATOR/LEGAL DECISION REQUIRED: identify the legal basis for analytics and
decide whether these tools require opt-in in the markets served. The product
must either honor “Necessary only” by preventing optional analytics from
loading, or remove the false choice and use legally reviewed notice text.]`

### 7. Support and bug reports

The desktop app lets you preview a report before sending it. A report can
contain your description of the problem, app version, language, operating
system, and optional diagnostics or runtime logs. The client redacts known
personal-data and secret patterns, writes the same report to a local Markdown
file, and sends the previewed content to the Job Hunter Team support endpoint.
Redaction reduces risk but cannot guarantee that free text contains no personal
data. Review the preview and remove anything you do not want to share.

A submitted desktop report may be delivered to our support mailbox through
Resend, summarized to a configured support webhook, and published in the public
Job Hunter Team GitHub repository as an issue visible to anyone. Do not include
information you want to keep private. GitHub processes public issue content
under its own [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

The web contact and web dashboard support forms currently send their limited
content to the support mailbox and, if configured, a support webhook. They do
not publish a GitHub issue. The endpoint also processes an IP address for
short-window abuse prevention. The desktop retains its local report copy until
you delete it.

`[OPERATOR DECISION REQUIRED: name or remove the configured webhook recipient;
confirm support-mail, GitHub-issue, webhook, rate-limit, and server-log
retention; define the process for removing personal data accidentally included
in a public issue.]`

### 8. Desktop network requests

The desktop app checks the public GitHub Releases API for a newer version at
most once per day. You can disable this in Settings or by setting
`JHT_UPDATE_CHECK=0`. It does not install an update without your action.

At normal startup, the app requests public exchange-rate data from Frankfurter
to compare salaries in different currencies. When you open and use the map, it
requests map tiles from CARTO. GitHub, Frankfurter, and CARTO receive ordinary
network request metadata such as IP address, request time, and user agent under
their own policies. These requests are product utilities, not Job Hunter Team
behavioral telemetry.

`[OPERATOR DECISION REQUIRED: approve these defaults, add working privacy links
for Frankfurter and CARTO, and decide whether the exchange-rate request needs an
in-product opt-out or should be made only when its feature is opened.]`

### 9. Who receives data

We disclose data only as needed for the feature you use:

| Recipient | Why it receives data |
|---|---|
| Supabase | Google-backed authentication, cloud database, realtime synchronization, and on-demand file transfer |
| Google | Authentication when you choose Google sign-in; no additional Google-product scopes are requested by JHT login |
| Anthropic, OpenAI, or Kimi/Moonshot | Model requests and task context sent by the official provider client you choose |
| Your VPS provider | Hosting and processing the workspace if you choose to run JHT on a VPS |
| Vercel | Hosting, security, aggregate web analytics, and performance measurements |
| Resend and the project support mailbox | Delivering support and feedback email |
| GitHub | Public desktop bug issues when that destination is enabled |
| GitHub, Frankfurter, and CARTO | Desktop update metadata, public exchange rates, and map tiles respectively; each receives ordinary network request metadata |
| `[CONFIGURED WEBHOOK RECIPIENT]` | A redacted summary of support reports, if enabled |

These providers process data under their own terms and privacy documents and,
where applicable, under contracts with the controller.

`[OPERATOR/LEGAL DECISION REQUIRED: verify the complete production vendor
inventory, locations, subprocessors, data-processing agreements, and any
international-transfer mechanism before publication.]`

### 10. Retention and deletion

Data in your local workspace or your VPS remains there until you delete it or
the relevant storage under your control.

At the audited commit, no complete self-service deletion flow or verified
automatic retention schedule exists for cloud account and synchronized data.
That data may remain until staff act on a verified request. Pairing codes are
short-lived; device tokens remain until their configured expiry or revocation.
On-demand file transfer is designed to be temporary, but its production cleanup
job must be verified before a precise deletion promise is published.

Support email, public GitHub issues, webhook deliveries, hosting logs,
analytics, backups, and abuse-prevention records have different retention
paths. The controller must approve and publish a schedule before release.

`[OPERATOR/LEGAL DECISION REQUIRED: provide a retention period or deletion
criterion for each category above. The database contains deferred tombstone
cleanup, so do not promise automatic deletion after 30 days. Confirm backup
retention and deletion propagation.]`

### 11. Your choices and requests

You can use the local product without connecting the cloud dashboard. You can
disconnect or revoke a paired device and can choose which external AI provider
account to use.

To request access, a portable export, correction, deletion, restriction, or
information about your data, email
[support@jobhunterteam.ai](mailto:support@jobhunterteam.ai). We may need to
verify that you control the relevant account before acting on a request. The
current profile-download feature is not a complete account export, so requests
for a full export require the support process.

`[OPERATOR/LEGAL DECISION REQUIRED: confirm who handles these requests, the
identity-verification method, response times, deletion runbook, export format,
and escalation path. Add any rights and supervisory-authority language required
by the applicable jurisdictions.]`

### 12. Children

`[OPERATOR/LEGAL DECISION REQUIRED: choose and legally review the minimum age,
whether parental consent is supported, and the process for deleting a minor's
data. Do not publish an invented age threshold.]`

### 13. Security and changes

We use access controls and other technical measures intended to protect the
hosted service, but no system is completely secure. You are responsible for
securing your own computer, VPS, provider accounts, and backups.

When this policy changes, we will publish a new version and last-updated date.
`[OPERATOR/LEGAL DECISION REQUIRED: define which changes require notice or new
acknowledgement, and how notice is delivered.]`

## Terms of Service — English draft

### Terms of Service

- **Version:** `2026-08-07-draft.1`
- **Last updated:** 7 August 2026
- **Effective:** `[OPERATOR DECISION REQUIRED]`

These Terms govern the hosted Job Hunter Team services and your use of the Job
Hunter Team software. The open-source software is also distributed under the
MIT License. If these Terms conflict with rights granted by the MIT License for
the software itself, the MIT License controls those software-license rights.

`[OPERATOR/LEGAL DECISION REQUIRED: insert the full legal name and address of
the contracting party. Do not publish “we” without identifying who “we” is.]`

### 1. Eligibility and acceptance

By creating an account or using the hosted services, you agree to the version
of these Terms shown above and acknowledge the Privacy Policy.

`[OPERATOR/LEGAL DECISION REQUIRED: choose and legally review a minimum age,
whether parental consent is supported, and whether a person accepting for an
organization represents that they have authority to bind it.]`

### 2. What Job Hunter Team does

Job Hunter Team coordinates AI agents that can research job opportunities,
compare them with a profile, score positions, and draft application materials.
It can run in Docker on your computer or a VPS you choose. You can optionally
connect it to the hosted cloud dashboard.

Job Hunter Team assists your work; it does not act as an employer, recruiter,
employment agency, lawyer, or financial adviser, and it does not guarantee a
job, interview, response, or particular outcome.

### 3. Open-source license and hosted services

The software is available under the MIT License and is provided under that
license's terms, including its warranty disclaimer. The hosted website,
authentication, synchronization, support, and other online services are
operated services and may have availability, security, and usage limits that
are not promises made by the MIT License.

`[LEGAL REVIEW REQUIRED: add any hosted-service warranty disclaimer,
limitation of liability, mandatory consumer-law savings clause, and liability
cap. Do not copy a clause from another service.]`

### 4. Your accounts and infrastructure

You are responsible for securing your computer, VPS, Google account, selected
AI-provider account, and access credentials. You are also responsible for the
VPS provider and configuration you choose, including access control, updates,
backups, data location, and deletion.

Google sign-in is used to authenticate your dashboard account. It does not
grant Job Hunter Team access to Gmail, Google Drive, Calendar, or Contacts.
Optional Team Gmail configuration is separate and is activated by you in the
local team.

### 5. Third-party AI providers and services

You choose and supply the account for a supported AI provider. Your use of
Anthropic, OpenAI, Kimi/Moonshot, Google, your VPS provider, and third-party job
platforms is governed by their current terms, policies, limits, and charges.
Job Hunter Team does not resell or bill your AI-provider subscription.

The desktop also uses GitHub to check for releases, Frankfurter for public
exchange rates, and CARTO for map tiles as described in the Privacy Policy.

You are responsible for checking that your use of Job Hunter Team is permitted
by each provider and third-party platform you use.

### 6. Your content and data

You keep your rights in the CV, profile, job materials, instructions, and other
content you provide. You authorize the software and the service providers
identified in the Privacy Policy to process that content only as needed to
provide features you choose, operate and secure the service, and handle support
requests, subject to the legal bases that must be approved before publication.

You must have the right to provide the content you submit. Do not use Job
Hunter Team to process another person's confidential or personal information
without authorization.

`[OPERATOR/LEGAL DECISION REQUIRED: define whether JHT needs a narrowly scoped
hosted-content licence, its duration, and how it ends after deletion. Do not
claim ownership of user content.]`

### 7. AI-generated material and user responsibility

AI-generated research, scores, CVs, cover letters, messages, and other output
may be incomplete, inaccurate, outdated, biased, or unsuitable. Review every
material decision and every submission before relying on or sending it. You
remain responsible for the accuracy of your applications, your communications,
and compliance with applicable rules.

### 8. Acceptable use

Do not use Job Hunter Team to break the law; deceive, impersonate, harass, or
defraud; send spam; bypass access controls or rate limits; interfere with the
service or another person's systems; distribute malware; infringe rights; or
violate a third-party platform's terms.

Automated job-search activity can be restricted by a job platform even when
the software technically permits it. You are responsible for the actions you
approve and the accounts you connect.

`[OPERATOR/LEGAL DECISION REQUIRED: approve a complete acceptable-use and
enforcement policy, including warning, suspension, appeal, and termination.]`

### 9. Bug reports and public GitHub issues

The desktop app shows a preview of a redacted bug report before sending it. If
you submit that report, it may be published as a public GitHub issue visible to
anyone. Review the preview and do not submit information you want to keep
private. Web contact and dashboard support messages are not published to
GitHub under the current routing.

### 10. Suspension, termination, export, and deletion

You can stop using the software at any time. Deleting a local workspace or VPS
is under your control. Disconnecting a device does not delete cloud data.

To request a complete export or deletion of a cloud account and synchronized
data, email [support@jobhunterteam.ai](mailto:support@jobhunterteam.ai). The
current product does not provide complete self-service export or deletion.

`[OPERATOR/LEGAL DECISION REQUIRED: define grounds and process for service
suspension or termination; notice and appeal; what data is retained after
termination and why; refunds or subscription consequences, if any; and an
operational deletion/export commitment.]`

### 11. Service changes

The software and hosted services may change. Material changes to these Terms
will receive a new version and last-updated date.

`[OPERATOR/LEGAL DECISION REQUIRED: define notice period, delivery method,
effective date, and whether continued use or explicit reacceptance applies.
Avoid a blanket “we may change anything at any time” clause.]`

### 12. Governing law and disputes

`[OPERATOR/LEGAL DECISION REQUIRED: choose governing law, courts or dispute
process, consumer-law carve-outs, and the contracting entity's jurisdiction
with qualified legal advice.]`

### 13. Contact

Questions about these Terms:
[support@jobhunterteam.ai](mailto:support@jobhunterteam.ai).

## Operator decisions

These are blockers, not editorial polish:

1. **Controller and contracting party — P0.** What is the full legal name,
   legal form, registration or tax details if required, and postal address?
2. **Working privacy channel — P0.** Is `support@jobhunterteam.ai` staffed for
   privacy requests, or will `privacy@jobhunterteam.ai` be created and tested?
3. **Deletion and export — P0.** Who performs a verified request today, by
   what runbook, within what response time, and across which live databases,
   storage, backups, support systems, and public issues? Will self-service ship
   before release?
4. **Retention — P0.** Approve periods or criteria for active-account cloud
   data, deleted/tombstoned records, backups, pairing codes and tokens,
   temporary file transfers, rate-limit data, hosting logs, analytics, support
   mail, webhook payloads, and GitHub issues.
5. **Age and minors — P0.** What minimum age applies? Is parental consent
   supported? What happens if a minor's data is discovered?
6. **Legal bases — P0.** For each purpose—contract/service delivery,
   authentication, cloud sync, support, security/rate limiting, analytics, and
   provider transfers—which legal basis applies in each target market?
7. **Analytics choice — P0.** Gate optional analytics behind a real opt-in,
   disable it, or approve different notice and legal-basis treatment. The
   current “Necessary only” control does not change loading behavior.
8. **Vendor inventory — P0.** Confirm production use and configuration of
   Supabase, Vercel, Google, Resend, Upstash, GitHub, and the support webhook;
   identify any other processor, subprocessor, region, and backup system.
9. **International transfers — P0.** Which transfer mechanisms and provider
   agreements apply to the target users and production regions?
10. **Jurisdiction and disputes — P0.** Choose governing law, courts or dispute
    process, mandatory consumer protections, and the contracting entity.
11. **Terms lifecycle — P1.** Which changes require explicit reacceptance?
    How and when are users notified? What is the first effective date?
12. **Enforcement and liability — P1.** Approve acceptable-use enforcement,
    suspension/appeal, hosted-service warranties, mandatory-law savings, and a
    defensible liability structure with legal review.
13. **Public-report remediation — P1.** Who monitors new GitHub issues and who
    can promptly remove personal data that escapes redaction?
14. **User-content permission — P1.** Approve the narrow licence, if any,
    needed to store and synchronize user content without taking ownership.

## Implementation contract for web and desktop

- Keep Privacy and Terms version constants centralized and identical across
  web and desktop release artifacts.
- Record explicit Terms acceptance separately from Privacy acknowledgement and
  from optional analytics consent.
- Store the accepted versions, timestamp, and surface. Store no extra personal
  data merely to prove acceptance.
- On Google sign-in, expose both legal links before the OAuth redirect.
- On desktop first run, show the same current versions and persist the local
  acceptance record. Re-prompt only under the approved versioning policy.
- Show the public-GitHub warning only where the route can publish an issue and
  immediately before submission, next to the exact report preview.
- Never describe the web Support dialog as public while `web-*` clients skip
  `openIssue()`.
- Make “Necessary only” control actual analytics loading if the operator and
  legal review choose opt-in. A stored label without behavioral effect is not
  consent.
- Do not translate placeholders into invented answers. All seven published
  languages must use the same approved versions and material meaning.

## Technical evidence reviewed

Audit baseline: `b949dc89bc611cff97c00bd3e0cbcebce46022a0`.

- Existing legal copy: `web/app/privacy/page.tsx`,
  `web/app/terms/page.tsx`.
- Google OAuth: `web/app/components/landing/LandingClient.tsx`,
  `web/app/(protected)/settings/cloud-sync/CloudSyncClient.tsx`.
- Cloud data model: `supabase/migrations/001_schema.sql` through
  `supabase/migrations/061_team_state_emergency_stop.sql`.
- Feedback destinations: `web/app/api/feedback/route.ts`,
  `web/lib/feedback-report.ts`, `game/scripts/support/feedback_service.gd`.
- Desktop external requests: `game/scripts/support/update_service.gd`,
  `game/scripts/support/update_check.gd`,
  `game/scripts/backend/backend_bus.gd`, `game/scripts/ui/osm_map.gd`.
- CV upload path: `game/scripts/backend/vps_backend.gd`,
  `game/scripts/backend/local_backend.gd`.
- Export boundary: `web/app/api/profile/export/route.ts`,
  `web/app/api/cloud-sync/full-dump/route.ts`.
- Analytics and consent behavior: `web/app/layout.tsx`,
  `web/app/components/landing/CookieConsent.tsx`.
