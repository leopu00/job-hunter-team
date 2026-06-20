"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../../../components/landing/LandingI18n";
import LandingNav from "../../../components/landing/LandingNav";
import { LandingFooter } from "../../../components/landing/LandingCTA";
import ScrollToTop from "../../../components/landing/ScrollToTop";

const TITLE_CLS =
  "text-[15px] font-bold text-[var(--color-white)] mt-10 mb-3 flex items-center gap-2";
const SUBTITLE_CLS =
  "text-[13px] font-bold text-[var(--color-white)] mt-6 mb-2";
const P_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed mb-3";
const LI_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed";
const CODE_CLS =
  "px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-white)] text-[11px] font-mono";

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 pl-3 border-l-2 border-[var(--color-green)] text-[12px] text-[var(--color-muted)] leading-relaxed">
      {children}
    </div>
  );
}

function ForwardingContent() {
  // Keep the i18n provider for chrome (nav/footer), but the guide body is
  // English-only, like the other site guides.
  useLandingI18n();

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <LandingNav />
      <div className="max-w-3xl mx-auto px-5 pt-32 pb-20">
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/"
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
            >
              Home
            </Link>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-dim)]">Docs</span>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-muted)]">
              Email Forwarding
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            📧 Email Forwarding
          </h1>
          <p className="text-[var(--color-dim)] text-[10px] mt-2">
            Feed the team your job alerts
          </p>
          <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">
            Give the team a <strong>dedicated email address</strong> and
            auto-forward your job-alert notifications to it. The Captain and the
            Scouts read that inbox at the start of every working day and turn
            the alerts into scored positions — without getting lost on the open
            web.
          </p>
        </div>

        <Callout>
          ✅ <strong>Optional, but strongly recommended.</strong> The team works
          fine without it (the Scouts search the web on their own), but it is{" "}
          <strong>noticeably less efficient</strong>. If you set up forwarding,
          you decide what reaches the team; if you don&apos;t, the team has to
          figure it out alone.
        </Callout>

        <Callout>
          📸 <strong>Missing screenshots:</strong> this guide doesn&apos;t have
          screenshots of the steps yet. The placeholders are listed at the
          bottom under <em>Graphic materials</em>.
        </Callout>

        {/* Why */}
        <h2 className={TITLE_CLS}>💡 Why it makes the team better</h2>
        <p className={P_CLS}>
          A job alert that <em>you</em> configured is already filtered to what
          you want: the right role, the right city, the right seniority. When
          that alert lands in the team inbox, the Scouts get a{" "}
          <strong>pre-qualified lead</strong> instead of guessing keywords on
          the open web. Concretely:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 mb-3">
          <li className={LI_CLS}>
            🎯 <strong>Higher accuracy</strong> — the position matches your real
            intent (your alert filters), not a Scout&apos;s best guess.
          </li>
          <li className={LI_CLS}>
            💸 <strong>Less token waste</strong> — no broad web crawling, no
            fighting login walls. The Scout reads a link the platform already
            vetted for you.
          </li>
          <li className={LI_CLS}>
            🧩 <strong>More tailored over time</strong> — tune your alert
            filters and the team&apos;s input changes with you.
          </li>
          <li className={LI_CLS}>
            🌍 <strong>Any platform, not just LinkedIn</strong> — forward alerts
            from LinkedIn, Glassdoor, Indeed <strong>and</strong> any
            local/country/city-specific job board that emails you. If it sends a
            notification, the team can read it.
          </li>
        </ul>
        <p className={P_CLS}>
          Every position the team creates is tagged with its{" "}
          <strong>source</strong> (e.g. <code className={CODE_CLS}>
            linkedin-email
          </code>{" "}
          vs a web search), so you can see on the dashboard how the
          email-sourced ones compare.
        </p>

        <Callout>
          🔗 <strong>LinkedIn is the single highest-value setup.</strong>{" "}
          Configure your search filters on LinkedIn, save them as a{" "}
          <strong>Job Alert</strong>, enable <strong>email notifications</strong>
          , then forward those emails to the team. This one source alone makes
          the Scouts dramatically more effective.
        </Callout>

        {/* Three steps */}
        <h2 className={TITLE_CLS}>🗺️ The three steps</h2>
        <pre className="my-3 p-4 rounded-md bg-[var(--color-border)] overflow-x-auto">
          <code className="text-[11px] font-mono text-[var(--color-muted)] leading-relaxed whitespace-pre">
            {`1. Create a dedicated inbox for the team   →  e.g. yourname.jht@gmail.com
2. Share it with the team (desktop app)    →  email + app-password, saved locally
3. Auto-forward your job alerts into it    →  from LinkedIn + any platform`}
          </code>
        </pre>

        {/* Step 1 */}
        <h2 className={TITLE_CLS}>1️⃣ Create a dedicated inbox</h2>
        <p className={P_CLS}>
          Make a <strong>fresh, separate</strong> email address that the team
          will read — don&apos;t give it your personal inbox. A free Gmail
          account works well (the team defaults to{" "}
          <code className={CODE_CLS}>imap.gmail.com</code>). Keep it dedicated to
          job alerts only: everything that lands there is treated as a potential
          lead.
        </p>
        <Callout>
          🔒 <strong>Why dedicated:</strong> the team reads this inbox over IMAP.
          A separate address means it never touches your personal mail, and you
          can revoke access any time by changing one password.
        </Callout>

        {/* Step 2 */}
        <h2 className={TITLE_CLS}>
          2️⃣ Share the inbox with the team (desktop app)
        </h2>
        <p className={P_CLS}>
          In the <strong>JHT desktop app</strong>, open{" "}
          <strong>Settings → Team email</strong> and enter:
        </p>
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                  Field
                </th>
                <th className="text-left py-2 text-[var(--color-white)] font-bold">
                  What to put
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-border)]">
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  <strong>Email address</strong>
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  the dedicated inbox, e.g.{" "}
                  <code className={CODE_CLS}>yourname.jht@gmail.com</code>
                </td>
              </tr>
              <tr className="border-b border-[var(--color-border)]">
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  <strong>App password</strong>
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  an <strong>app-specific password</strong>, not your login
                  password
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={P_CLS}>
          The desktop app saves these <strong>locally</strong> (in the
          team&apos;s <code className={CODE_CLS}>credentials/</code> folder on
          the machine that runs the team) — they are <strong>never</strong> sent
          to the cloud.
        </p>
        <Callout>
          🔑 <strong>App password (Gmail):</strong> enable 2-Step Verification,
          then create an <em>App password</em> (Google Account → Security → App
          passwords) and paste that. It&apos;s a 16-character token you can
          revoke independently, so the team never holds your real password.
          Other providers (Outlook, Fastmail, …) have the same concept — look
          for &quot;app password&quot; or &quot;IMAP access token&quot;.
        </Callout>
        <p className={P_CLS}>
          The <strong>&quot;How to set up forwarding&quot;</strong> button in
          that window brings you back to this guide.
        </p>

        {/* Step 3 */}
        <h2 className={TITLE_CLS}>3️⃣ Auto-forward your job alerts</h2>
        <p className={P_CLS}>
          This is the part that lives in <strong>your</strong> mailbox. You
          create rules that forward job-alert emails into the dedicated inbox.
          Set up as many sources as you like.
        </p>

        <h3 className={SUBTITLE_CLS}>🔗 LinkedIn (most recommended)</h3>
        <ol className="list-decimal pl-5 space-y-1.5 mb-3">
          <li className={LI_CLS}>
            Run the search you care about on LinkedIn (role, location, filters).
          </li>
          <li className={LI_CLS}>
            Save it as a <strong>Job Alert</strong> and set the frequency (daily
            is a good default).
          </li>
          <li className={LI_CLS}>
            Make sure <strong>email notifications</strong> are on for that alert
            (Settings → Communications → Email → Jobs).
          </li>
          <li className={LI_CLS}>
            In your personal mailbox, add a <strong>filter/rule</strong>: when
            the sender is{" "}
            <code className={CODE_CLS}>jobs-listings@linkedin.com</code> (or{" "}
            <code className={CODE_CLS}>jobalerts-noreply@linkedin.com</code>),{" "}
            <strong>forward</strong> to your dedicated team inbox.
          </li>
        </ol>

        <h3 className={SUBTITLE_CLS}>📨 Gmail (forwarding rule)</h3>
        <ol className="list-decimal pl-5 space-y-1.5 mb-3">
          <li className={LI_CLS}>
            <strong>
              Settings → Forwarding and POP/IMAP → Add a forwarding address
            </strong>{" "}
            → your team inbox, and confirm it.
          </li>
          <li className={LI_CLS}>
            <strong>Settings → Filters → Create a new filter</strong> → match
            the alert senders (e.g.{" "}
            <code className={CODE_CLS}>
              from:(linkedin.com OR glassdoor.com OR indeed.com)
            </code>
            ), then <strong>Forward it to</strong> your team inbox.
          </li>
        </ol>

        <h3 className={SUBTITLE_CLS}>📨 Outlook / others</h3>
        <p className={P_CLS}>
          Use <strong>Rules</strong> (Outlook) or your provider&apos;s
          equivalent: <em>if sender contains the job-board domain → forward to</em>{" "}
          the team inbox.
        </p>

        <h3 className={SUBTITLE_CLS}>
          🌍 Any other platform (local / country / niche boards)
        </h3>
        <p className={P_CLS}>
          Same recipe for <strong>every</strong> site that emails you job
          notifications — national boards, city portals, niche communities.
          Subscribe to their alerts, then forward those emails to the team
          inbox. The team reads the <strong>whole</strong> dedicated inbox, so
          new platforms work without any extra configuration on the team side.
        </p>
        <Callout>
          💡 <strong>Tip:</strong> because the inbox is dedicated, you can
          forward <em>broadly</em> and let the team sort it out — you don&apos;t
          need a perfect filter on your side.
        </Callout>

        {/* How the team uses it */}
        <h2 className={TITLE_CLS}>🤖 How the team uses it</h2>
        <ul className="list-disc pl-5 space-y-1.5 mb-3">
          <li className={LI_CLS}>
            🌅 <strong>Start of day</strong> — the Captain and the Scouts check
            the team inbox first thing in the working window, before any web
            search. Overnight alerts are already waiting.
          </li>
          <li className={LI_CLS}>
            🧮 <strong>The Captain balances the load</strong> — if a reasonable
            number of alerts arrived, the team reads them all (more signal is
            better). If a <em>flood</em> arrives (say hundreds in one day), the
            Captain picks the <strong>most salient</strong> ones and pushes
            those through, so the goal is always met:{" "}
            <strong>new positions reach a score</strong>, not just pile up
            un-scored.
          </li>
          <li className={LI_CLS}>
            📊 <strong>You see the result</strong> — the positions show up on
            your dashboard, scored, tagged with their email source.
          </li>
        </ul>
        <Callout>
          🎯 <strong>The team&apos;s target is the score, not the cover
          letter.</strong>{" "}
          CV/cover-letter writing stays on-demand (you click when you want it).
          Forwarding good alerts means more of the <em>right</em> positions get
          scored within the team&apos;s budget.
        </Callout>

        {/* Verify */}
        <h2 className={TITLE_CLS}>✅ Verify it&apos;s working</h2>
        <p className={P_CLS}>
          After you&apos;ve set up forwarding and entered the credentials, the
          team confirms access at the next start-of-day check. You can also
          watch your dashboard: within a working window you should start seeing
          positions whose source is an <code className={CODE_CLS}>*-email</code>{" "}
          tag.
        </p>
        <p className={P_CLS}>If nothing shows up:</p>
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                  Symptom
                </th>
                <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                  Likely cause
                </th>
                <th className="text-left py-2 text-[var(--color-white)] font-bold">
                  Fix
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  No <code className={CODE_CLS}>*-email</code> positions appear
                </td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  credentials not saved / wrong
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  re-enter email + <strong>app password</strong> in the desktop
                  app
                </td>
              </tr>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  &quot;Login failed&quot; in the team logs
                </td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  using login password, not app password
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  create an <strong>app-specific password</strong> and use that
                </td>
              </tr>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  Alerts arrive but aren&apos;t forwarded
                </td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  mailbox rule not matching
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  check the sender address in your forwarding filter
                </td>
              </tr>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  Inbox empty
                </td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  alerts not enabled at the source
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  turn on <strong>email notifications</strong> for your
                  LinkedIn/board alerts
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Privacy */}
        <h2 className={TITLE_CLS}>🔒 Privacy &amp; security</h2>
        <ul className="list-disc pl-5 space-y-1.5 mb-3">
          <li className={LI_CLS}>
            The credentials are stored <strong>locally</strong>, with the team —{" "}
            <strong>never</strong> uploaded to the cloud.
          </li>
          <li className={LI_CLS}>
            Use a <strong>dedicated inbox</strong> and an{" "}
            <strong>app-specific password</strong> so the team never holds your
            personal mail or your real login.
          </li>
          <li className={LI_CLS}>
            Revoke any time: delete the app password (the team simply stops
            reading) or change it in the desktop app.
          </li>
        </ul>

        {/* Graphic materials */}
        <h2 className={TITLE_CLS}>🖼️ Graphic materials</h2>
        <p className={P_CLS}>
          This guide is user-facing but <strong>has no screenshots yet</strong>.
          Placeholders to fill in:
        </p>
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                  #
                </th>
                <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                  Expected screenshot
                </th>
                <th className="text-left py-2 text-[var(--color-white)] font-bold">
                  Target path
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">1</td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  Desktop <strong>Settings → Team email</strong> form (email +
                  app-password + &quot;How to set up forwarding&quot; button)
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  <code className={CODE_CLS}>
                    docs/guides/assets/email-01-desktop-form.png
                  </code>
                </td>
              </tr>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">2</td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  Gmail <strong>App password</strong> creation screen
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  <code className={CODE_CLS}>
                    docs/guides/assets/email-02-app-password.png
                  </code>
                </td>
              </tr>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">3</td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  LinkedIn <strong>Job Alert</strong> with email notifications on
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  <code className={CODE_CLS}>
                    docs/guides/assets/email-03-linkedin-alert.png
                  </code>
                </td>
              </tr>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">4</td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  Gmail <strong>forwarding filter</strong> forwarding alerts to
                  the team inbox
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  <code className={CODE_CLS}>
                    docs/guides/assets/email-04-gmail-filter.png
                  </code>
                </td>
              </tr>
              <tr className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-muted)]">5</td>
                <td className="py-2 pr-4 text-[var(--color-muted)]">
                  Dashboard showing positions tagged with an{" "}
                  <code className={CODE_CLS}>*-email</code> source
                </td>
                <td className="py-2 text-[var(--color-muted)]">
                  <code className={CODE_CLS}>
                    docs/guides/assets/email-05-dashboard-source.png
                  </code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
          <Link
            href="/"
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline"
          >
            &larr; Home
          </Link>
          <Link
            href="/privacy"
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline"
          >
            Privacy Policy &rarr;
          </Link>
        </div>
      </div>
      <LandingFooter />
      <ScrollToTop />
    </main>
  );
}

export default function EmailForwardingGuidePage() {
  return (
    <LandingI18nProvider>
      <ForwardingContent />
    </LandingI18nProvider>
  );
}
