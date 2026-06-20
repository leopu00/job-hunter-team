# 📧 Email Forwarding — feed the team your job alerts

Give the team a **dedicated email address** and auto-forward your job-alert
notifications to it. The Captain and the Scouts read that inbox at the start of
every working day and turn the alerts into scored positions — without getting
lost on the open web.

> ✅ **Optional, but strongly recommended.** The team works fine without it
> (the Scouts search the web on their own), but it is **noticeably less
> efficient**. If you set up forwarding, you decide what reaches the team; if you
> don't, the team has to figure it out alone.

> 📸 **Missing screenshots**: this guide doesn't have screenshots of the steps
> yet. See [§Graphic materials](#-graphic-materials) at the bottom for the
> placeholders to fill in.

---

## 💡 Why it makes the team better

A job alert that *you* configured is already filtered to what you want: the right
role, the right city, the right seniority. When that alert lands in the team
inbox, the Scouts get a **pre-qualified lead** instead of guessing keywords on
the open web. Concretely:

- 🎯 **Higher accuracy** — the position matches your real intent (your alert
  filters), not a Scout's best guess.
- 💸 **Less token waste** — no broad web crawling, no fighting login walls. The
  Scout reads a link the platform already vetted for you.
- 🧩 **More tailored over time** — tune your alert filters and the team's input
  changes with you.
- 🌍 **Any platform, not just LinkedIn** — forward alerts from LinkedIn,
  Glassdoor, Indeed **and** any local/country/city-specific job board that emails
  you. If it sends a notification, the team can read it.

Every position the team creates is tagged with its **source** (e.g.
`linkedin-email` vs a web search), so you can see on the dashboard how the
email-sourced ones compare.

> 🔗 **LinkedIn is the single highest-value setup.** Configure your search
> filters on LinkedIn, save them as a **Job Alert**, enable **email
> notifications**, then forward those emails to the team. This one source alone
> makes the Scouts dramatically more effective.

---

## 🗺️ The three steps

```
1. Create a dedicated inbox for the team   →  e.g. yourname.jht@gmail.com
2. Share it with the team (desktop app)    →  email + app-password, saved locally
3. Auto-forward your job alerts into it    →  from LinkedIn + any platform
```

---

## 1️⃣ Create a dedicated inbox

Make a **fresh, separate** email address that the team will read — don't give it
your personal inbox. A free Gmail account works well (the team defaults to
`imap.gmail.com`). Keep it dedicated to job alerts only: everything that lands
there is treated as a potential lead.

> 🔒 **Why dedicated:** the team reads this inbox over IMAP. A separate address
> means it never touches your personal mail, and you can revoke access any time
> by changing one password.

---

## 2️⃣ Share the inbox with the team (desktop app)

In the **JHT desktop app**, open **Settings → Team email** and enter:

| Field | What to put |
|---|---|
| **Email address** | the dedicated inbox, e.g. `yourname.jht@gmail.com` |
| **App password** | an **app-specific password**, not your login password |

The desktop app saves these **locally** (in the team's `credentials/` folder on
the machine that runs the team) — they are **never** sent to the cloud.

> 🔑 **App password (Gmail):** enable 2-Step Verification, then create an
> *App password* (Google Account → Security → App passwords) and paste that. It's
> a 16-character token you can revoke independently, so the team never holds your
> real password. Other providers (Outlook, Fastmail, …) have the same concept —
> look for "app password" or "IMAP access token".

The **"How to set up forwarding"** button in that window brings you back to this
guide.

---

## 3️⃣ Auto-forward your job alerts

This is the part that lives in **your** mailbox. You create rules that forward
job-alert emails into the dedicated inbox. Set up as many sources as you like.

### 🔗 LinkedIn (most recommended)

1. Run the search you care about on LinkedIn (role, location, filters).
2. Save it as a **Job Alert** and set the frequency (daily is a good default).
3. Make sure **email notifications** are on for that alert
   (Settings → Communications → Email → Jobs).
4. In your personal mailbox, add a **filter/rule**: when the sender is
   `jobs-listings@linkedin.com` (or `jobalerts-noreply@linkedin.com`), **forward**
   to your dedicated team inbox.

### 📨 Gmail (forwarding rule)

1. **Settings → Forwarding and POP/IMAP → Add a forwarding address** → your team
   inbox, and confirm it.
2. **Settings → Filters → Create a new filter** → match the alert senders (e.g.
   `from:(linkedin.com OR glassdoor.com OR indeed.com)`), then
   **Forward it to** your team inbox.

### 📨 Outlook / others

Use **Rules** (Outlook) or your provider's equivalent: *if sender contains the
job-board domain → forward to* the team inbox.

### 🌍 Any other platform (local / country / niche boards)

Same recipe for **every** site that emails you job notifications — national
boards, city portals, niche communities. Subscribe to their alerts, then forward
those emails to the team inbox. The team reads the **whole** dedicated inbox, so
new platforms work without any extra configuration on the team side.

> 💡 **Tip:** because the inbox is dedicated, you can forward *broadly* and let
> the team sort it out — you don't need a perfect filter on your side.

---

## 🤖 How the team uses it

- 🌅 **Start of day** — the Captain and the Scouts check the team inbox first
  thing in the working window, before any web search. Overnight alerts are
  already waiting.
- 🧮 **The Captain balances the load** — if a reasonable number of alerts arrived,
  the team reads them all (more signal is better). If a *flood* arrives (say
  hundreds in one day), the Captain picks the **most salient** ones and pushes
  those through, so the goal is always met: **new positions reach a score**, not
  just pile up un-scored.
- 📊 **You see the result** — the positions show up on your dashboard, scored,
  tagged with their email source.

> 🎯 **The team's target is the *score*, not the cover letter.** CV/cover-letter
> writing stays on-demand (you click when you want it). Forwarding good alerts
> means more of the *right* positions get scored within the team's budget.

---

## ✅ Verify it's working

After you've set up forwarding and entered the credentials, the team confirms
access at the next start-of-day check. You can also watch your dashboard: within
a working window you should start seeing positions whose source is an
`*-email` tag.

If nothing shows up:

| Symptom | Likely cause | Fix |
|---|---|---|
| No `*-email` positions appear | credentials not saved / wrong | re-enter email + **app password** in the desktop app |
| "Login failed" in the team logs | using login password, not app password | create an **app-specific password** and use that |
| Alerts arrive but aren't forwarded | mailbox rule not matching | check the sender address in your forwarding filter |
| Inbox empty | alerts not enabled at the source | turn on **email notifications** for your LinkedIn/board alerts |

---

## 🔒 Privacy & security

- The credentials are stored **locally**, with the team — **never** uploaded to
  the cloud.
- Use a **dedicated inbox** and an **app-specific password** so the team never
  holds your personal mail or your real login.
- Revoke any time: delete the app password (the team simply stops reading) or
  change it in the desktop app.

---

## 🖼️ Graphic materials

This guide is user-facing but **has no screenshots yet**. Placeholders:

| # | Expected screenshot | Target path |
|---|---|---|
| 1 | Desktop **Settings → Team email** form (email + app-password + "How to set up forwarding" button) | `docs/guides/assets/email-01-desktop-form.png` |
| 2 | Gmail **App password** creation screen | `docs/guides/assets/email-02-app-password.png` |
| 3 | LinkedIn **Job Alert** with email notifications on | `docs/guides/assets/email-03-linkedin-alert.png` |
| 4 | Gmail **forwarding filter** forwarding alerts to the team inbox | `docs/guides/assets/email-04-gmail-filter.png` |
| 5 | Dashboard showing positions tagged with an `*-email` source | `docs/guides/assets/email-05-dashboard-source.png` |

When you add the images, replace the `> 📸 Missing screenshots` callout at the
top with markdown embeds: `![Desktop form](assets/email-01-desktop-form.png)`.

---

## 📚 Related

- 🚀 [`QUICKSTART`](QUICKSTART.md) — install and first run
- 🖥️ [`VPS-SETUP-WIZARD`](VPS-SETUP-WIZARD.md) — run the team on a VPS via the desktop wizard
- 🤖 [`docs/about/RESULTS`](../about/RESULTS.md) — case studies and metrics
