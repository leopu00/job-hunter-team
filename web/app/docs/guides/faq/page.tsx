import { getRequestLocale } from "@/lib/request-locale";
import { DocHeader, H3, P, Callout, GitHubMore } from "../../DocKit";
import { repoTree } from "../../repo";
import { T } from "./page.i18n";

const DISCUSSIONS = "https://github.com/leopu00/job-hunter-team/discussions";
const LINK_CLS =
  "text-[var(--color-white)] underline underline-offset-2 hover:text-[var(--color-green)] transition-colors";

export default async function FaqPage() {
  const locale = await getRequestLocale();
  const t = T[locale];

  const qa: [string, string][] = [
    [t.q1, t.a1],
    [t.q2, t.a2],
    [t.q3, t.a3],
    [t.q4, t.a4],
    [t.q5, t.a5],
    [t.q6, t.a6],
    [t.q7, t.a7],
    [t.q8, t.a8],
    [t.q9, t.a9],
    [t.q10, t.a10],
  ];

  return (
    <div>
      <DocHeader emoji="❓" title={t.title} tagline={t.tagline}>
        {t.intro}
      </DocHeader>

      {qa.map(([q, a], i) => (
        <div key={i}>
          <H3>{q}</H3>
          <P>{a}</P>
        </div>
      ))}

      <Callout>
        💬 <strong>{t.stillStrong}</strong>
        {t.stillRest}
        <a
          href={DISCUSSIONS}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLS}
        >
          GitHub Discussions
        </a>
        .
      </Callout>

      <GitHubMore href={repoTree("docs")}>{t.githubMore}</GitHubMore>
    </div>
  );
}
