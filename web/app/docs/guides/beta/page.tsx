import { getRequestLocale } from "@/lib/request-locale";
import { DocHeader, H2, P, UL, LI, Callout, GitHubMore } from "../../DocKit";
import { repoTree } from "../../repo";
import { T } from "./page.i18n";

const ISSUES = "https://github.com/leopu00/job-hunter-team/issues/new";
const LINK_CLS =
  "text-[var(--color-white)] underline underline-offset-2 hover:text-[var(--color-green)] transition-colors";

export default async function BetaPage() {
  const locale = await getRequestLocale();
  const t = T[locale];

  return (
    <div>
      <DocHeader emoji="🧪" title={t.title} tagline={t.tagline}>
        {t.intro}
      </DocHeader>

      <H2>{t.whyH}</H2>
      <P>{t.whyP}</P>

      <H2>{t.whoH}</H2>
      <P>{t.whoLead}</P>
      <UL>
        <LI>{t.who1}</LI>
        <LI>{t.who2}</LI>
        <LI>{t.who3}</LI>
      </UL>
      <P>{t.whoNoTech}</P>

      <H2>{t.getH}</H2>
      <UL>
        <LI>{t.get1}</LI>
        <LI>{t.get2}</LI>
        <LI>{t.get3}</LI>
        <LI>{t.get4}</LI>
      </UL>

      <H2>{t.askH}</H2>
      <UL>
        <LI>{t.ask1}</LI>
        <LI>{t.ask2}</LI>
        <LI>{t.ask3}</LI>
        <LI>{t.ask4}</LI>
        <LI>{t.ask5}</LI>
      </UL>

      <H2>{t.applyH}</H2>
      <P>{t.applyLead}</P>
      <UL>
        <LI>{t.aq1}</LI>
        <LI>{t.aq2}</LI>
        <LI>{t.aq3}</LI>
        <LI>{t.aq4}</LI>
        <LI>{t.aq5}</LI>
        <LI>{t.aq6}</LI>
      </UL>
      <Callout>
        🧪{" "}
        <a
          href={ISSUES}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLS}
        >
          {t.applyCta}
        </a>{" "}
        — {t.applyNote}
      </Callout>

      <H2>{t.expectH}</H2>
      <P>{t.expectLead}</P>
      <UL>
        <LI>{t.exp1}</LI>
        <LI>{t.exp2}</LI>
        <LI>{t.exp3}</LI>
      </UL>
      <P>{t.expectClose}</P>

      <GitHubMore href={repoTree("docs")}>{t.githubMore}</GitHubMore>
    </div>
  );
}
