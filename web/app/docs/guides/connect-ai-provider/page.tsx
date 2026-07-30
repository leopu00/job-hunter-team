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
} from "../../DocKit";
import { repoFile } from "../../repo";
import { getRequestLocale } from "@/lib/request-locale";
import { T } from "./page.i18n";

export default async function ConnectAiProviderPage() {
  const locale = await getRequestLocale();
  const t = T[locale];

  return (
    <div>
      <DocHeader emoji="🧠" title={t.title} tagline={t.tagline}>
        {t.intro}
      </DocHeader>

      <H2>{t.whichProvider}</H2>
      <P>{t.whichProviderP}</P>
      <UL>
        <LI>
          🌙 <strong>Kimi</strong> {t.kimi}
        </LI>
        <LI>
          🔵 <strong>Codex</strong> {t.codex}
        </LI>
        <LI>
          🟠 <strong>Claude</strong> {t.claude}
        </LI>
      </UL>
      <Callout>
        ⚠️ <strong>{t.dedicatedStrong}</strong> {t.dedicatedRest}{" "}
        <Link
          href="/pricing"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          {t.pricingLink}
        </Link>{" "}
        {t.pricingAfter}
      </Callout>

      <H2>{t.connectIt}</H2>
      <P>
        {t.connectP1} <Code>jht setup</Code>, {t.connectP2}
      </P>

      <H3>{t.step1}</H3>
      <Pre>
        {`jht providers list           # claude | codex | kimi
jht providers use kimi       # set the active one
jht providers update kimi    # install its CLI inside the container`}
      </Pre>

      <H3>{t.step2}</H3>
      <P>
        <strong>{t.step2P1Strong}</strong>
        {t.step2P1Rest}
      </P>
      <Pre>
        {`jht oauth-login    # opens the provider's device-flow login in a TTY`}
      </Pre>
      <P>{t.step2P2}</P>

      <H3>{t.step3}</H3>
      <Pre>
        {`jht providers current   # the active provider
jht providers check     # provider CLIs with an update available
jht doctor              # full health check — must exit 0`}
      </Pre>

      <H2>{t.switching}</H2>
      <P>{t.switchingP}</P>
      <Pre>
        {`jht providers use claude && jht providers update claude
jht team stop --all && jht team start   # reload the team`}
      </Pre>

      <Callout>
        🔐 <strong>{t.neverLeavesStrong}</strong> {t.neverLeavesRest}
      </Callout>

      <GitHubMore href={repoFile("docs/guides/AI-AGENT-INTEGRATION.md")}>
        AI-AGENT-INTEGRATION.md
      </GitHubMore>
    </div>
  );
}
