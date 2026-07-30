import Link from "next/link";
import { getRequestLocale } from "@/lib/request-locale";
import { CODE_CLS, DESKTOP_SOON, T } from "./page.i18n";

const TITLE_CLS =
  "text-[15px] font-bold text-[var(--color-white)] mt-10 mb-3 flex items-center gap-2";
const SUBTITLE_CLS =
  "text-[13px] font-bold text-[var(--color-white)] mt-6 mb-2";
const P_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed mb-3";
const LI_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed";

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 pl-3 border-l-2 border-[var(--color-green)] text-[12px] text-[var(--color-muted)] leading-relaxed">
      {children}
    </div>
  );
}

export default async function EmailForwardingGuidePage() {
  const locale = await getRequestLocale();
  const t = T[locale] ?? T.en;

  return (
    <div>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-3">
          <Link
            href="/"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.bcHome}
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <Link
            href="/docs"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.bcDocs}
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">
            {t.bcEmail}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          {t.pageTitle}
        </h1>
        <p className="text-[var(--color-dim)] text-[10px] mt-2">
          {t.pageSubtitle}
        </p>
        <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">
          {t.intro}
        </p>
      </div>

      <Callout>{DESKTOP_SOON[locale] ?? DESKTOP_SOON.en}</Callout>

      <Callout>{t.calloutOptional}</Callout>

      <Callout>{t.calloutScreens}</Callout>

      {/* Why */}
      <h2 className={TITLE_CLS}>{t.whyTitle}</h2>
      <p className={P_CLS}>{t.whyIntro}</p>
      <ul className="list-disc pl-5 space-y-1.5 mb-3">
        <li className={LI_CLS}>{t.whyAccuracy}</li>
        <li className={LI_CLS}>{t.whyTokens}</li>
        <li className={LI_CLS}>{t.whyTailored}</li>
        <li className={LI_CLS}>{t.whyAnyPlatform}</li>
      </ul>
      <p className={P_CLS}>{t.whySource}</p>

      <Callout>{t.calloutLinkedin}</Callout>

      {/* Three steps */}
      <h2 className={TITLE_CLS}>{t.stepsTitle}</h2>
      <pre className="my-3 p-4 bg-[var(--color-border)] overflow-x-auto">
        <code className="text-[11px] font-mono text-[var(--color-muted)] leading-relaxed whitespace-pre">
          {t.stepsCode}
        </code>
      </pre>

      {/* Step 1 */}
      <h2 className={TITLE_CLS}>{t.step1Title}</h2>
      <p className={P_CLS}>{t.step1Body}</p>
      <Callout>{t.step1Callout}</Callout>

      {/* Step 2 */}
      <h2 className={TITLE_CLS}>{t.step2Title}</h2>
      <p className={P_CLS}>{t.step2Body}</p>
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                {t.tblField}
              </th>
              <th className="text-left py-2 text-[var(--color-white)] font-bold">
                {t.tblWhatToPut}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--color-border)]">
              <td className="py-2 pr-4 text-[var(--color-muted)]">
                {t.rowEmailLabel}
              </td>
              <td className="py-2 text-[var(--color-muted)]">
                {t.rowEmailValue}
              </td>
            </tr>
            <tr className="border-b border-[var(--color-border)]">
              <td className="py-2 pr-4 text-[var(--color-muted)]">
                {t.rowPwLabel}
              </td>
              <td className="py-2 text-[var(--color-muted)]">{t.rowPwValue}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={P_CLS}>{t.step2Local}</p>
      <Callout>{t.step2Callout}</Callout>
      <p className={P_CLS}>{t.step2Button}</p>

      {/* Step 3 */}
      <h2 className={TITLE_CLS}>{t.step3Title}</h2>
      <p className={P_CLS}>{t.step3Body}</p>

      <h3 className={SUBTITLE_CLS}>{t.liSubtitle}</h3>
      <ol className="list-decimal pl-5 space-y-1.5 mb-3">
        <li className={LI_CLS}>{t.li1}</li>
        <li className={LI_CLS}>{t.li2}</li>
        <li className={LI_CLS}>{t.li3}</li>
        <li className={LI_CLS}>{t.li4}</li>
      </ol>

      <h3 className={SUBTITLE_CLS}>{t.gmailSubtitle}</h3>
      <ol className="list-decimal pl-5 space-y-1.5 mb-3">
        <li className={LI_CLS}>{t.gmail1}</li>
        <li className={LI_CLS}>{t.gmail2}</li>
      </ol>

      <h3 className={SUBTITLE_CLS}>{t.outlookSubtitle}</h3>
      <p className={P_CLS}>{t.outlookBody}</p>

      <h3 className={SUBTITLE_CLS}>{t.anySubtitle}</h3>
      <p className={P_CLS}>{t.anyBody}</p>
      <Callout>{t.anyCallout}</Callout>

      {/* How the team uses it */}
      <h2 className={TITLE_CLS}>{t.usesTitle}</h2>
      <ul className="list-disc pl-5 space-y-1.5 mb-3">
        <li className={LI_CLS}>{t.usesStartOfDay}</li>
        <li className={LI_CLS}>{t.usesBalance}</li>
        <li className={LI_CLS}>{t.usesResult}</li>
      </ul>
      <Callout>{t.usesCallout}</Callout>

      {/* Verify */}
      <h2 className={TITLE_CLS}>{t.verifyTitle}</h2>
      <p className={P_CLS}>{t.verifyBody}</p>
      <p className={P_CLS}>{t.verifyIfNothing}</p>
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                {t.tblSymptom}
              </th>
              <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                {t.tblCause}
              </th>
              <th className="text-left py-2 text-[var(--color-white)] font-bold">
                {t.tblFix}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.v1s}</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.v1c}</td>
              <td className="py-2 text-[var(--color-muted)]">{t.v1f}</td>
            </tr>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.v2s}</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.v2c}</td>
              <td className="py-2 text-[var(--color-muted)]">{t.v2f}</td>
            </tr>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.v3s}</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.v3c}</td>
              <td className="py-2 text-[var(--color-muted)]">{t.v3f}</td>
            </tr>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.v4s}</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.v4c}</td>
              <td className="py-2 text-[var(--color-muted)]">{t.v4f}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Privacy */}
      <h2 className={TITLE_CLS}>{t.privacyTitle}</h2>
      <ul className="list-disc pl-5 space-y-1.5 mb-3">
        <li className={LI_CLS}>{t.privacy1}</li>
        <li className={LI_CLS}>{t.privacy2}</li>
        <li className={LI_CLS}>{t.privacy3}</li>
      </ul>

      {/* Graphic materials */}
      <h2 className={TITLE_CLS}>{t.graphicsTitle}</h2>
      <p className={P_CLS}>{t.graphicsBody}</p>
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                {t.tblHash}
              </th>
              <th className="text-left py-2 pr-4 text-[var(--color-white)] font-bold">
                {t.tblExpected}
              </th>
              <th className="text-left py-2 text-[var(--color-white)] font-bold">
                {t.tblPath}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">1</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.g1}</td>
              <td className="py-2 text-[var(--color-muted)]">
                <code className={CODE_CLS}>
                  docs/guides/assets/email-01-desktop-form.png
                </code>
              </td>
            </tr>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">2</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.g2}</td>
              <td className="py-2 text-[var(--color-muted)]">
                <code className={CODE_CLS}>
                  docs/guides/assets/email-02-app-password.png
                </code>
              </td>
            </tr>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">3</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.g3}</td>
              <td className="py-2 text-[var(--color-muted)]">
                <code className={CODE_CLS}>
                  docs/guides/assets/email-03-linkedin-alert.png
                </code>
              </td>
            </tr>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">4</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.g4}</td>
              <td className="py-2 text-[var(--color-muted)]">
                <code className={CODE_CLS}>
                  docs/guides/assets/email-04-gmail-filter.png
                </code>
              </td>
            </tr>
            <tr className="border-b border-[var(--color-border)] align-top">
              <td className="py-2 pr-4 text-[var(--color-muted)]">5</td>
              <td className="py-2 pr-4 text-[var(--color-muted)]">{t.g5}</td>
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
          href="/docs"
          className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline"
        >
          &larr; {t.allDocs}
        </Link>
        <Link
          href="/privacy"
          className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline"
        >
          {t.privacyPolicy} &rarr;
        </Link>
      </div>
    </div>
  );
}
