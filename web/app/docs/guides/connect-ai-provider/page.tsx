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
          🟢 <strong>GLM</strong> {t.apiKey}
        </LI>
        <LI>⏳ {t.coming}</LI>
      </UL>

      <H2>{t.connectIt}</H2>
      <P>
        {t.connectP1} <Code>jht setup</Code>, {t.connectP2}
      </P>
      <Pre>
        {`jht setup                                                   # asks for the key, typed hidden
jht setup --non-interactive --provider glm --api-key-file <file>
jht setup --non-interactive --provider glm --api-key-stdin < <file>`}
      </Pre>
      <P>{t.apiKeyP1}</P>
      <P>{t.apiKeyP2}</P>

      <H3>{t.step3}</H3>
      <Pre>
        {`jht providers current   # the active provider: glm
jht doctor              # full health check — must exit 0`}
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
