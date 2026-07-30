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

export default async function GettingStartedPage() {
  const locale = await getRequestLocale();
  const t = T[locale];
  return (
    <div>
      <DocHeader emoji="🚀" title={t.title} tagline={t.tagline}>
        {t.headerBody}
      </DocHeader>

      <Callout>
        ⚡ <strong>{t.fastestLabel}</strong>
        {t.fastestBody}
      </Callout>

      <H2>{t.subTitle}</H2>
      <P>
        {t.subIntroA}
        <strong>{t.subIntroB}</strong>
        {t.subIntroC}
        <strong>{t.subEmphOne}</strong>
        {t.subIntroD}
      </P>
      <UL>
        <LI>
          🌙 <strong>Kimi</strong>
          {t.kimi}
        </LI>
        <LI>
          🔵 <strong>Codex</strong>
          {t.codex}
        </LI>
        <LI>
          🟠 <strong>Claude</strong>
          {t.claude}
        </LI>
      </UL>
      <Callout>
        ⚠️ <strong>{t.dedicateLabel}</strong>
        {t.dedicateBody}
        <Link
          href="/pricing"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          {t.pricingPage}
        </Link>
        .
      </Callout>

      <H2>{t.pickTitle}</H2>

      <H3>{t.path1Title}</H3>
      <P>{t.path1Intro}</P>
      <Pre>
        {`"Set up Job Hunter Team from
github.com/leopu00/job-hunter-team for my profile.
I have a [Kimi Pro / Codex / Claude Max] subscription.
Walk me through what you need."`}
      </Pre>
      <P>
        {t.path1AfterA}
        <Code>jht doctor</Code>
        {t.path1AfterB}
      </P>

      <H3>{t.path2Title}</H3>
      <P>
        {t.path2SoonA}
        <Link
          href="/download"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          {t.downloadPage}
        </Link>
        {t.path2SoonB}
      </P>

      <H3>{t.path3Title}</H3>
      <P>{t.path3Mac}</P>
      <Pre>{`curl -fsSL https://jobhunterteam.ai/install.sh | bash`}</Pre>
      <P>{t.path3WinIntro}</P>
      <Pre>{`iwr -useb https://jobhunterteam.ai/install.ps1 | iex`}</Pre>
      <P>{t.path3WizardIntro}</P>
      <Pre>
        {`jht up            # start the container (pulls the image first run)
jht setup         # wizard: provider, OAuth login, team start
jht doctor        # check everything is healthy
jht team status   # confirm it's running`}
      </Pre>
      <P>
        {t.dockerReqA}
        <strong>Docker</strong>
        {t.dockerReqB}
      </P>

      <H2>{t.firstRunTitle}</H2>
      <P>{t.firstRunIntro}</P>
      <UL>
        <LI>
          <strong>{t.fr1A}</strong>
          {t.fr1B}
          {t.fr1C}
          <Code>candidate_profile.yml</Code>.
        </LI>
        <LI>
          {t.fr2A}
          <Link
            href="/docs/guides/email-forwarding"
            className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
          >
            {t.emailForwarding}
          </Link>
          .
        </LI>
        <LI>
          <strong>{t.fr3A}</strong>
          {t.fr3B}
        </LI>
        <LI>
          <strong>{t.fr4A}</strong>{" "}
          <Link
            href="/docs/guides/dashboard-and-results"
            className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
          >
            {t.dashboardLink}
          </Link>
          {t.fr4B}
        </LI>
      </UL>

      <Callout>
        {t.stuckA}
        <Code>jht doctor</Code>
        {t.stuckB}
        <Link
          href="/docs/guides/run-on-a-vps"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          {t.vpsLink}
        </Link>
        .
      </Callout>

      <GitHubMore href={repoFile("docs/guides/QUICKSTART.md")}>
        QUICKSTART.md
      </GitHubMore>
    </div>
  );
}
