"use client";

import Link from "next/link";
import {
  DocHeader,
  Callout,
  H2,
  H3,
  P,
  UL,
  LI,
  Code,
  Pre,
  GitHubMore,
  repoTree,
} from "../../DocKit";

export default function DashboardAndResultsPage() {
  return (
    <div>
      <DocHeader
        emoji="📊"
        title="Your dashboard & results"
        tagline="Where the team's work shows up — and how to read it"
      >
        Once the team is running it produces a steady stream of positions, each
        verified and scored against your profile. This page explains what you
        see and how the numbers work.
      </DocHeader>

      <H2>🔄 How a position flows</H2>
      <P>
        Every job moves through the pipeline before it reaches you. The score is
        the key signal:
      </P>
      <Pre>
        {`🕵️  Scout    finds a position           → new
🔬  Analyst  verifies the role + company → checked
💯  Scorer   scores it 0–100 vs you      → scored
              ├─ score < 40  → set aside
              └─ score ≥ 50  → handed to the Writer
✍️  Writer   drafts a tailored CV + letter
⚖️  Critic   blind-reviews it (3 rounds)  → ready
👤  You      review and decide what to send`}
      </Pre>
      <Callout>
        🎯 <strong>The score is a compatibility estimate, not a verdict.</strong>{" "}
        It ranks how well a posting matches your profile — you stay the judge of
        what&apos;s worth pursuing. Nothing is ever submitted on your behalf.
      </Callout>

      <H2>🖥️ Where to read it</H2>

      <H3>The web dashboard</H3>
      <P>From a browser you get the full picture:</P>
      <UL>
        <LI>Every position found, with its match score.</LI>
        <LI>The map of opportunities by city and country.</LI>
        <LI>The status of each application.</LI>
        <LI>The team&apos;s activity and current spending.</LI>
      </UL>

      <H3>The terminal, if you prefer</H3>
      <Pre>
        {`jht positions list        # all positions in the local DB
jht positions show 42     # detail of one position
jht positions dashboard   # a TTY-friendly view
jht stats                 # found / scored / applied counts`}
      </Pre>

      <H2>🔐 Login is optional</H2>
      <P>
        Signing up lets you reach your data from any device — but it&apos;s not
        required. You can keep <strong>everything on your own computer</strong>,
        no cloud involved:
      </P>
      <UL>
        <LI>
          <strong>With sign-up</strong> — local data mirrors to the cloud; open{" "}
          <Code>jobhunterteam.ai</Code> from any browser, share with a mentor.
          Your CVs stay local; only metadata syncs.
        </LI>
        <LI>
          <strong>Without</strong> — fully local. The dashboard lives at{" "}
          <Code>localhost:3000</Code>, nothing external is touched.
        </LI>
      </UL>
      <Callout>
        🌐 On the public site the dashboard is <strong>read-only</strong> for
        safety. Anything that changes your team or your data happens from the
        desktop app or the CLI, on your machine.
      </Callout>

      <H2>📄 The output you act on</H2>
      <P>
        Approved applications land as ready-to-send packages (CV + cover letter)
        in your <Code>Job Hunter Team</Code> documents folder, marked{" "}
        <strong>&quot;Ready to submit&quot;</strong>. You open, review and send
        them yourself.
      </P>

      <GitHubMore href={repoTree("docs")}>the docs on GitHub</GitHubMore>
    </div>
  );
}
