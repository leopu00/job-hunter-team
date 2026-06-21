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

export default function ConnectAiProviderPage() {
  return (
    <div>
      <DocHeader
        emoji="🧠"
        title="Connect your AI provider"
        tagline="The provider is the team's brain — and the only thing you pay for"
      >
        The platform is free and open source. The intelligence behind the agents
        comes from an LLM provider you choose and sign into. This page connects
        it.
      </DocHeader>

      <H2>🤔 Which provider?</H2>
      <P>
        Three are supported and tested. Pick one — you can switch later in a
        couple of commands.
      </P>
      <UL>
        <LI>
          🌙 <strong>Kimi</strong> (Moonshot Pro, ~€40/mo) — cheapest, validated
          on multi-day runs. The mass-market starting point.
        </LI>
        <LI>
          🔵 <strong>Codex</strong> (OpenAI Plus/Pro, ~€100/mo) — balanced
          quality and cost.
        </LI>
        <LI>
          🟠 <strong>Claude</strong> (Anthropic Max x20, ~€200/mo) — top
          precision for scoring and CV writing.
        </LI>
      </UL>
      <Callout>
        ⚠️ <strong>Use a dedicated subscription.</strong> Sharing the account
        you use for personal AI drains the same weekly quota twice and the team
        will hit rate limits. See the{" "}
        <Link
          href="/pricing"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          pricing page
        </Link>{" "}
        for the full comparison.
      </Callout>

      <H2>🔌 Connect it</H2>
      <P>
        The setup wizard already asks for your provider and runs the sign-in. If
        you ran <Code>jht setup</Code>, you&apos;re likely done. To do it (or
        redo it) by hand:
      </P>

      <H3>1. Select the provider</H3>
      <Pre>
        {`jht providers list           # claude | codex | kimi
jht providers use kimi       # set the active one
jht providers update kimi    # install its CLI inside the container`}
      </Pre>

      <H3>2. Sign in (OAuth device flow)</H3>
      <P>
        These are <strong>subscriptions, not API keys</strong>: you log into
        your provider account through a browser device-flow, the same way their
        own CLI does. The wizard launches this for you; to force a clean login:
      </P>
      <Pre>
        {`jht oauth-login    # opens the provider's device-flow login in a TTY`}
      </Pre>
      <P>
        Follow the on-screen URL + code, confirm in the browser, and the
        credentials are stored inside the container (never in git).
      </P>

      <H3>3. Verify</H3>
      <Pre>
        {`jht providers current   # active provider + model
jht providers check     # confirm the CLI is installed and reachable
jht doctor              # full health check — must exit 0`}
      </Pre>

      <H2>🔄 Switching provider later</H2>
      <P>Change your mind any time:</P>
      <Pre>
        {`jht providers use claude && jht providers update claude
jht team stop --all && jht team start   # reload the team`}
      </Pre>

      <Callout>
        🔐 <strong>What never leaves your machine:</strong> provider credentials
        live inside your container. We never see them, and they&apos;re never
        pushed to the cloud or to git.
      </Callout>

      <GitHubMore href={repoFile("docs/guides/AI-AGENT-INTEGRATION.md")}>
        AI-AGENT-INTEGRATION.md
      </GitHubMore>
    </div>
  );
}
