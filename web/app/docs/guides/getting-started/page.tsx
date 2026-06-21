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
  repoFile,
} from "../../DocKit";

export default function GettingStartedPage() {
  return (
    <div>
      <DocHeader
        emoji="🚀"
        title="Getting Started"
        tagline="From zero to a running team in about 10 minutes"
      >
        Job Hunter Team is a team of AI agents that hunt, vet, score and tailor
        job applications for you, around the clock. This page gets it running.
      </DocHeader>

      <Callout>
        ⚡ <strong>The fastest path:</strong> if you already use an AI assistant
        (Claude Code, OpenClaw, Codex, Cursor…), just point it at this guide and
        the repo and ask it to set everything up. The whole CLI is built to be
        driven by an agent — you may not have to type a single command yourself.
      </Callout>

      <H2>🧠 First, one subscription</H2>
      <P>
        The team runs on an <strong>LLM subscription</strong>, not pay-per-use
        API keys — it works around the clock and that would get expensive. You
        need an active plan with <strong>one</strong> of three providers:
      </P>
      <UL>
        <LI>
          🌙 <strong>Kimi</strong> (Moonshot Pro, ~€40/mo) — the affordable,
          mass-market tier. A great place to start.
        </LI>
        <LI>
          🔵 <strong>Codex</strong> (OpenAI Plus/Pro, ~€100/mo) — a balance of
          quality and cost.
        </LI>
        <LI>
          🟠 <strong>Claude</strong> (Anthropic Max x20, ~€200/mo) — the highest
          precision, best for scoring and writing.
        </LI>
      </UL>
      <Callout>
        ⚠️ <strong>Dedicate the subscription to the team.</strong> Don&apos;t
        reuse the same account you use for personal AI — they share one weekly
        quota and the team will hit limits unexpectedly. More on the{" "}
        <Link
          href="/pricing"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          pricing page
        </Link>
        .
      </Callout>

      <H2>🛤️ Then, pick how you install</H2>

      <H3>🦞 Path 1 — Let your AI assistant do it</H3>
      <P>If you use a coding assistant, tell it something like:</P>
      <Pre>
        {`"Set up Job Hunter Team from
github.com/leopu00/job-hunter-team for my profile.
I have a [Kimi Pro / Codex / Claude Max] subscription.
Walk me through what you need."`}
      </Pre>
      <P>
        It will read the docs, install the CLI, run <Code>jht doctor</Code>, fix
        what&apos;s missing and start the team. This is a primary design goal,
        not a hack.
      </P>

      <H3>🖥️ Path 2 — Desktop app (no terminal)</H3>
      <P>
        Download the launcher from{" "}
        <Link
          href="/download"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          the download page
        </Link>{" "}
        (macOS <Code>.dmg</Code>, Windows <Code>.exe</Code>, Linux{" "}
        <Code>.AppImage</Code>/<Code>.deb</Code>). Open it, then the wizard:
      </P>
      <UL>
        <LI>Picks your language and installs the container runtime for you.</LI>
        <LI>Signs you into your provider through an embedded terminal.</LI>
        <LI>
          Click <strong>Start</strong> — the team boots and your browser opens
          on the dashboard.
        </LI>
      </UL>
      <Callout>
        💡 The desktop app is the{" "}
        <strong>on/off switch and setup wizard</strong>, not where you read
        results. After it starts the team you interact via the web dashboard,
        Telegram or the CLI.
      </Callout>

      <H3>📦 Path 3 — One-liner installer</H3>
      <P>macOS / Linux / WSL2:</P>
      <Pre>{`curl -fsSL https://jobhunterteam.ai/install.sh | bash`}</Pre>
      <P>Windows (PowerShell, Docker Desktop must already be running):</P>
      <Pre>{`iwr -useb https://jobhunterteam.ai/install.ps1 | iex`}</Pre>
      <P>Then bring the team up and run the wizard:</P>
      <Pre>
        {`jht up            # start the container (pulls the image first run)
jht setup         # wizard: provider, OAuth login, team start
jht doctor        # check everything is healthy
jht team status   # confirm it's running`}
      </Pre>
      <P>
        The one requirement is <strong>Docker</strong> — the installer sets up
        the runtime on macOS and Linux for you (on Windows it expects Docker
        Desktop already installed). No Node, Python or tmux on your machine:
        everything lives inside the container.
      </P>

      <H2>🎬 Your first run</H2>
      <P>Whichever path you took:</P>
      <UL>
        <LI>
          <strong>Set up your profile.</strong> Chat with the Assistant at{" "}
          <Code>/onboarding</Code> — it writes your{" "}
          <Code>candidate_profile.yml</Code> for you.
        </LI>
        <LI>
          <strong>Feed it your job alerts</strong> (optional but recommended) —
          see{" "}
          <Link
            href="/docs/guides/email-forwarding"
            className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
          >
            Email Forwarding
          </Link>
          .
        </LI>
        <LI>
          <strong>Click Start.</strong> The Captain dispatches Scout → Analyst →
          Scorer → Writer → Critic; the Sentinel keeps everyone within the
          subscription window.
        </LI>
        <LI>
          <strong>Review the output</strong> from the{" "}
          <Link
            href="/docs/guides/dashboard-and-results"
            className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
          >
            dashboard
          </Link>
          . Nothing is ever submitted automatically — you decide what to send.
        </LI>
      </UL>

      <Callout>
        🩹 Stuck? <Code>jht doctor</Code> tells you exactly what&apos;s missing.
        For the always-on setup see{" "}
        <Link
          href="/docs/guides/run-on-a-vps"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          Run 24/7 on a VPS
        </Link>
        .
      </Callout>

      <GitHubMore href={repoFile("docs/guides/QUICKSTART.md")}>
        QUICKSTART.md
      </GitHubMore>
    </div>
  );
}
