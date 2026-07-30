import { getRequestLocale } from "@/lib/request-locale";
import { DocHeader, H3, P, Callout, GitHubMore } from "../../DocKit";
import { repoTree } from "../../repo";
import { T } from "./page.i18n";
import type { PrivacyCopy } from "./page.i18n";

export default async function PrivacyAndSecurityPage() {
  const locale = await getRequestLocale();
  const t = (T[locale] ?? T.en) as PrivacyCopy;

  const blocks: [string, string][] = [
    [t.h1, t.p1],
    [t.h2, t.p2],
    [t.h3, t.p3],
    [t.h4, t.p4],
    [t.h5, t.p5],
    [t.h6, t.p6],
    [t.h7, t.p7],
  ];

  return (
    <div>
      <DocHeader emoji="🔒" title={t.title} tagline={t.tagline}>
        {t.intro}
      </DocHeader>

      {blocks.map(([h, p], i) => (
        <div key={i}>
          <H3>{h}</H3>
          <P>{p}</P>
        </div>
      ))}

      <Callout>{t.closing}</Callout>

      <GitHubMore href={repoTree("docs")}>{t.githubMore}</GitHubMore>
    </div>
  );
}
