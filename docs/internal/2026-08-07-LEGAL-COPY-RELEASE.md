# Privacy and Terms — English publication source

> **Product copy approved by the operator on 7 August 2026.** This document
> describes the product and the operator's decisions. It is not legal advice or
> a declaration of compliance. Web and desktop translations must preserve the
> meaning and document versions below.

## Release contract

| Document | Version | Visible last updated |
|---|---|---|
| Privacy Policy | `2026-08-07.1` | 7 August 2026 |
| Terms of Service | `2026-08-07.1` | 7 August 2026 |

The controller's name is **Leone Emanuele Puglisi**. The project is maintained
by him as an individual, is free and open source, and is not operated as a
commercial business. Publish no home address, registered office, VAT number,
company name, or legal form.

Use [privacy@jobhunterteam.ai](mailto:privacy@jobhunterteam.ai) as the privacy
contact. The alias must be operationally verified before publication; if it is
not active, use [support@jobhunterteam.ai](mailto:support@jobhunterteam.ai)
consistently until it is created.

## Privacy Policy — publication copy

### Privacy Policy

- **Version:** `2026-08-07.1`
- **Last updated:** 7 August 2026

Job Hunter Team is local-first software with optional online services. This
policy explains what stays in an environment you control, what leaves it when
you choose an online feature, who receives it, and how to export or delete your
cloud data.

### 1. Data controller

The data controller for the hosted Job Hunter Team website, cloud dashboard,
and support channels is **Leone Emanuele Puglisi**, acting as an individual
maintainer of a free, non-commercial open-source project.

Privacy contact:
[privacy@jobhunterteam.ai](mailto:privacy@jobhunterteam.ai).

The project is open source and free; its maintainer does not operate it as a
commercial activity.

### 2. Local and VPS data

Job Hunter Team runs in a Docker workspace on your computer or on a virtual
private server (VPS) that you choose. That workspace may contain your profile,
contact details, CV and CV-derived structured data, job preferences, researched
positions, scores, applications, generated CVs and cover letters, team
messages, settings, logs, and work products.

When you upload a CV or another onboarding document, Job Hunter Team copies it
to `/jht_user/allegati` in the selected runtime and gives its path to the
Assistant agent. On a local runtime, the file remains on your device unless you
use a feature that sends specified data elsewhere. On a VPS runtime, the file
is uploaded to that VPS. Your VPS provider processes it under the account and
terms you selected.

We do not receive the contents of your local or VPS workspace merely because
you run Job Hunter Team. We receive specified data only when you enable cloud
synchronization or send a support report. Deleting cloud data does not delete
your local workspace or VPS; you control those copies.

### 3. External AI providers

Job Hunter Team uses the official client for the AI provider you select, such
as Anthropic, OpenAI, or Kimi/Moonshot. The client may send the prompts and
context needed for a task directly to that provider. Depending on the task,
that context can contain profile or CV information, job descriptions,
application materials, instructions, and generated work.

Those calls use your provider account and are governed by that provider's
terms, privacy policy, plan, and retention settings. Job Hunter Team does not
resell or bill your provider account. Provider credentials and session tokens
are managed by the provider's client in the environment where the team runs.

Review the current policies of [Anthropic](https://www.anthropic.com/legal/privacy),
[OpenAI](https://openai.com/policies/privacy-policy/), and
[Kimi](https://www.kimi.com/user/agreement/userprivacy?version=v2) before
choosing a provider.

### 4. Google sign-in

If you continue with Google, Google and Supabase process the information needed
to authenticate you. This can include your Google account identifier, email
address, email-verification status, name, and profile image.

Job Hunter Team does not request access to Gmail, Google Drive, Calendar,
Contacts, or other Google products as part of dashboard sign-in. Optional Team
Gmail access is a separate feature that you configure in the local team; it is
not granted by Google sign-in for the dashboard.

### 5. Cloud dashboard and synchronization

Cloud synchronization is optional. If you connect a local or VPS team to the
cloud dashboard, Supabase processes your authentication session and the data
you synchronize. Depending on the features you use, this can include:

- your structured profile, contact information, experience, education, skills,
  languages, work authorization, locations, and job preferences;
- companies, positions, job descriptions, scores, highlights, applications,
  statuses, and feedback;
- team state and history, directives, commands, chat and pending messages,
  onboarding state, views, and notification preferences;
- paired-device identifiers, synchronization-token metadata, file indexes, and
  temporary files transferred on demand.

Disconnecting or revoking a device stops its future synchronization. It does
not delete data that is already in your cloud account. Use the cloud deletion
control described in section 11 to delete that data.

### 6. Necessary browser storage

The hosted website uses necessary cookies or browser storage for
authentication, language, theme, onboarding, and preferences. Hosting and
security systems may process IP address, request headers, requested page,
timestamps, errors, and abuse signals to serve and protect the site and enforce
rate limits.

### 7. Analytics — only after your choice

Vercel Web Analytics and Speed Insights load only after you explicitly choose
**Accept** in the analytics notice. If you do not answer or choose
**Necessary only**, these measurement components do not load and you are not
measured by them.

When enabled, they provide aggregate usage and performance information such as
route or URL, timestamp, referrer, browser and device type, operating system,
country, network and performance values, and SDK version. See Vercel's
[Web Analytics privacy information](https://vercel.com/docs/analytics/privacy-policy)
and [Speed Insights privacy information](https://vercel.com/docs/speed-insights/privacy-policy).

You can change your analytics choice by clearing or changing the site's stored
consent preference.

### 8. CARTO live maps and other utility requests

The home page begins with a local static globe image. On capable devices, the
site may later initialize the live map. If the live map initializes, your
browser requests map resources from `basemaps.cartocdn.com`; CARTO therefore
receives ordinary request metadata such as your IP address, user agent, and
request time. Read [CARTO's Privacy Notice](https://carto.com/privacy/).

If your device stays on the static image—for example because it has no WebGL,
uses reduced motion, or falls back for performance reasons—it does not contact
CARTO for the live map.

The hosted web server, not your browser, requests public exchange rates from
Frankfurter and caches them. GitHub Release URLs on the website are ordinary
links, so your browser contacts GitHub only if you select one.

Job Hunter Team Desktop checks the public GitHub Releases API for a newer
version at most once per day; you can disable this in Settings. It requests
public Frankfurter exchange rates at startup and CARTO tiles when you use its
map. These services receive ordinary network request metadata. JHT Desktop
sends no behavioral telemetry to Job Hunter Team.

### 9. Support and bug reports

The desktop app shows the exact report it is preparing and applies redaction
rules before submission. A report can include your description, app version,
language, operating system, and optional diagnostics or runtime logs. Redaction
reduces risk but cannot guarantee that free text contains no personal data, so
review the preview before sending. The desktop also saves a local Markdown
copy, which remains until you delete it.

Submitted reports and web support messages are sent privately to the Job
Hunter Team support inbox through Resend. The submitted report remains in the
private support channel.

The support endpoint processes an IP address for short-window abuse prevention.
If a private operations webhook is enabled, it can receive a redacted summary;
it is not authorized to receive contact details or the full diagnostic report.

### 10. Who receives data

We share data only as needed for a feature you use:

| Recipient | Purpose |
|---|---|
| Supabase | Google-backed authentication, cloud database, realtime synchronization, and temporary file transfer |
| Google | Authentication when you choose Google sign-in |
| Anthropic, OpenAI, or Kimi/Moonshot | Model requests and task context sent by the official provider client you choose |
| Your VPS provider | Hosting and processing your workspace if you choose a VPS |
| Vercel | Hosting, security, and—only after explicit acceptance—aggregate analytics and performance measurement |
| CARTO | Live map resources requested by your browser or desktop client |
| Frankfurter | Public exchange rates requested by the hosted server or desktop client |
| Resend and the project support inbox | Private delivery of support and feedback email |
| A configured private operations webhook | A redacted support summary, if enabled |
| GitHub | Release information requested by the desktop or links you select |

These recipients process data under their own terms and privacy documents.

### 11. Cloud export and immediate deletion

While signed in, open **Settings** and find **Your data**.

Choose **Download my data (JSON)** to download a JSON file containing the data
owned by your cloud account. The export includes your account and basic profile
data; structured profile and contact data; experience, education, skills,
languages, authorizations, and preferences; companies, positions, scores,
applications, and feedback; team state, messages, directives, commands,
settings, and history; and device, synchronization, and file-index metadata. It
does not include token secrets, provider credentials, files that exist only in
your local or VPS workspace, or data held independently by an AI provider.

Under **Delete your account**, choose **Show me what will be deleted**, review
the preview, enter your account email, and choose **Delete permanently**. This
deletes your authentication account and all user-owned active cloud data,
including the categories listed above, pairing sessions, synchronization
tokens, pending transfers, and cloud storage objects. Deletion is immediate
and irreversible. Export first if you want a copy.

After a successful deletion, Job Hunter Team writes a technical audit entry
containing the deletion time, a non-reversible hashed account reference, and
per-table row counts. It contains none of the deleted content, your email
address, or your account identifier in clear text.

Cloud deletion does not delete:

- the workspace or files on your computer or VPS;
- data retained independently by Google, an AI provider, your VPS provider, or
  another third party under its own policy;
- support email already delivered to the private inbox.

If you cannot use the controls, request export or deletion from the email
address associated with your cloud account by writing to
[privacy@jobhunterteam.ai](mailto:privacy@jobhunterteam.ai). We may ask you to
verify control of the account before acting.

### 12. Retention and your choices

Your active cloud data remains until you delete the cloud account and data.
The active cloud copy is deleted immediately when you complete the confirmed
deletion flow. Pairing codes are short-lived; device tokens remain until their
configured expiry, revocation, or cloud deletion. On-demand transfer files are
temporary.

Support reports remain in the private support channel for investigation and
follow-up, unless you request their deletion. Hosting, security, backup, and
analytics systems follow the applicable provider lifecycle.

You can use the local product without a cloud account, refuse analytics,
disconnect or revoke devices, choose your model provider, export cloud data,
and immediately delete your cloud account and active cloud data.

For access, correction, export, deletion, restriction, or other privacy
questions, email
[privacy@jobhunterteam.ai](mailto:privacy@jobhunterteam.ai).

### 13. Minimum age

Job Hunter Team accounts and hosted services are for people aged **16 or
older**. We do not currently perform technical age verification. By creating an
account, you confirm that you are at least 16.

### 14. Security and policy changes

We use access controls and other technical measures intended to protect the
hosted services, but no system is completely secure. You are responsible for
securing your own computer, VPS, provider accounts, and backups.

When this policy changes, we will publish a new version and last-updated date.

### 15. Contact

Privacy questions and requests:
[privacy@jobhunterteam.ai](mailto:privacy@jobhunterteam.ai).

## Terms of Service — publication copy

### Terms of Service

- **Version:** `2026-08-07.1`
- **Last updated:** 7 August 2026

These Terms govern the hosted Job Hunter Team services and your use of the Job
Hunter Team software. The software is also distributed under the MIT License.
If these Terms conflict with rights granted by the MIT License for the software
itself, the MIT License controls those software-license rights.

### 1. Who provides Job Hunter Team

Job Hunter Team is maintained by **Leone Emanuele Puglisi**, acting as an
individual. It is a free, non-commercial open-source project, not a business.

- Contact: [support@jobhunterteam.ai](mailto:support@jobhunterteam.ai)
- Privacy: [privacy@jobhunterteam.ai](mailto:privacy@jobhunterteam.ai)

### 2. Minimum age and acceptance

You must be at least **16 years old** to create an account or use the hosted
services. We do not currently perform technical age verification. By creating
an account, you confirm that you are at least 16.

By creating an account or using the hosted services, you agree to version
`2026-08-07.1` of these Terms and acknowledge version `2026-08-07.1` of the
Privacy Policy.

### 3. What Job Hunter Team does

Job Hunter Team coordinates AI agents that can research job opportunities,
compare them with a profile, score positions, and draft application materials.
It can run in Docker on your computer or on a VPS you choose. You can
optionally connect it to the hosted cloud dashboard.

Job Hunter Team assists your work. It is not an employer, recruiter,
employment agency, lawyer, or financial adviser, and it does not guarantee a
job, interview, response, or particular outcome.

### 4. Open-source software and hosted services

The software is available under the MIT License and is provided under that
license's terms, including its warranty disclaimer. The hosted website,
authentication, synchronization, and support channels are free online services
operated for the project. They may have availability, security, and usage
limits that are separate from the software licence.

### 5. Your accounts and infrastructure

You are responsible for securing your computer, VPS, Google account, selected
AI-provider account, access credentials, and backups. If you choose a VPS, you
are responsible for its provider and configuration, including access control,
updates, data location, and deletion.

Google sign-in authenticates your dashboard account. It does not grant Job
Hunter Team access to Gmail, Google Drive, Calendar, or Contacts. Optional Team
Gmail configuration is separate and is activated by you in the local team.

### 6. Third-party providers and services

You choose and supply the account for a supported AI provider. Your use of
Anthropic, OpenAI, Kimi/Moonshot, Google, your VPS provider, job platforms, and
other third-party services is governed by their current terms, policies,
limits, and charges. Job Hunter Team does not resell or bill your AI-provider
subscription.

You are responsible for checking that your use of Job Hunter Team is permitted
by each provider and platform you use.

### 7. Your content and data

You keep your rights in the CV, profile, job materials, instructions, and other
content you provide. You authorize Job Hunter Team and the service providers
identified in the Privacy Policy to process that content only as needed to
provide the features you choose, operate and protect the hosted services, and
handle your support requests.

You must have the right to provide the content you submit. Do not use Job
Hunter Team to process another person's confidential or personal information
without authorization.

### 8. AI-generated material and your responsibility

AI-generated research, scores, CVs, cover letters, messages, and other output
may be incomplete, inaccurate, outdated, biased, or unsuitable. Review every
material decision and submission before relying on or sending it. You remain
responsible for the accuracy of your applications, your communications, and
compliance with applicable rules.

### 9. Acceptable use

Do not use Job Hunter Team to break the law; deceive, impersonate, harass, or
defraud; send spam; bypass access controls or rate limits; interfere with the
service or another person's systems; distribute malware; infringe rights; or
violate a third-party platform's terms.

Automated job-search activity can be restricted by a job platform even when
the software technically permits it. You are responsible for the actions you
approve and the accounts you connect.

### 10. Cloud export and deletion

You can export the data owned by your cloud account as JSON from **Settings →
Your data → Download my data (JSON)**.

You can immediately and irreversibly delete your authentication account and
all user-owned active cloud data from **Settings → Your data → Delete your
account**. Export first if you want a copy. Deleting cloud data
does not delete local or VPS files or data held independently by third-party
providers. The Privacy Policy describes the exact scope and fallback email
process.

### 11. Support reports

Support and bug reports are delivered privately to the Job Hunter Team support
inbox. They are not published automatically. Review desktop report previews and
do not submit information you do not want to share with support.

### 12. Service changes and availability

The software and hosted services may change, be interrupted, or be
discontinued. When these Terms change, we will publish a new version and
last-updated date. A material change may require you to accept a new version
before continuing to use an account or hosted service.

### 13. Warranty and responsibility limits

The open-source software is provided under the MIT License **“as is,” without
warranty of any kind**. To the extent permitted by applicable law, the free
hosted services are also provided without a promise that they will always be
available, error-free, or suitable for a particular purpose. Nothing in these
Terms limits rights or responsibilities that cannot lawfully be limited.

### 14. Contact

Questions about these Terms:
[support@jobhunterteam.ai](mailto:support@jobhunterteam.ai).

Privacy questions and data requests:
[privacy@jobhunterteam.ai](mailto:privacy@jobhunterteam.ai).

## Mandatory implementation contract

- Publish the exact versions and last-updated date above on both pages.
- Keep the controller spelling exactly `Leone Emanuele Puglisi`; publish no
  physical address, VAT number, company, registered office, or legal form.
- Expose Terms and Privacy links before Google authentication. The sign-in copy
  remains: “By continuing with Google, you agree to the Terms of Service and
  acknowledge the Privacy Policy.”
- Keep Vercel Analytics and Speed Insights fail-closed until stored consent is
  exactly `accepted`. No answer and `necessary` must load neither component.
- CARTO is disclosed, not consent-gated: the static home image makes no CARTO
  request; a browser that initializes the live map does.
- Remove automatic GitHub issue creation for every feedback client. Deliver
  reports privately to the domain support inbox.
- Provide a complete, authenticated cloud export before deletion. Export no
  token secret, hash, provider credential, or other security secret.
- Make cloud account deletion a strongly confirmed, immediate, irreversible
  action. Delete the auth user, every user-owned database row, pairing and sync
  tokens, pending file-transfer records, and cloud storage objects. Do not
  touch the user's local or VPS workspace.
- Retain at most the technical deletion audit entry described in the Privacy
  Policy; it must contain no deleted content or reversible account identifier.
- Use the same document versions in web acceptance records and any desktop
  acknowledgement. Analytics consent remains a separate decision.
- Translate the approved English meaning into all seven supported languages;
  do not translate service names, email addresses, paths, or version IDs.

## Operational verification before publication

These are checks, not missing product decisions:

1. Confirm that `privacy@jobhunterteam.ai` receives mail. If it does not, ship
   with `support@jobhunterteam.ai` everywhere and create the privacy alias
   before switching the text.
2. Verify end to end that cloud export contains every documented category and
   excludes secrets.
3. Verify end to end that confirmed deletion removes the auth user, all
   user-owned rows, pending transfers, and cloud storage objects immediately,
   and cannot be undone.
4. Verify that no feedback client calls GitHub automatically and that the
   private support inbox is the required delivery destination.
5. Verify all seven translations carry version `2026-08-07.1` and the same
   material meaning.

## Residual operator and legal-review questions

The seven product decisions requested on 7 August are incorporated above.
These remaining choices were not answered and must not be invented in the
published documents:

1. Which legal basis applies to authentication, cloud synchronization,
   security and rate limiting, support, and optional analytics in each target
   jurisdiction?
2. What retention period or objective deletion criterion applies to support
   mail, private webhook summaries, hosting and security logs, analytics,
   backups, and the minimal deletion audit entry?
3. Which governing law, courts or dispute process, mandatory consumer-law
   protections, and liability terms apply?
4. Which production regions, subprocessors, data-processing agreements, and
   international-transfer mechanisms apply to the final vendor inventory?
5. Which future changes require explicit acceptance of a new Terms version or
   acknowledgement of a new Privacy version?

These questions require the operator and, where appropriate, qualified legal
review. They are not technical implementation choices.
