import Link from "next/link";
import { getRequestLocale } from "@/lib/request-locale";
import { DESKTOP_SOON, T } from "./page.i18n";

// Guida: creare la Gmail DEDICATA del team + app-password così il team può
// leggerla via IMAP. Complementa /docs/guides/email-forwarding (il "perché" +
// l'inoltro automatico). Le stringhe stanno in `page.i18n.tsx`, accanto a
// questo file — pattern uguale alle altre guide.

const TITLE_CLS =
  "text-[15px] font-bold text-[var(--color-white)] mt-10 mb-3 flex items-center gap-2";
const P_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed mb-3";
const LI_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed";

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 pl-3 border-l-2 border-[var(--color-green)] text-[12px] text-[var(--color-muted)] leading-relaxed">
      {children}
    </div>
  );
}

export default async function TeamGmailGuidePage() {
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
            {t.bcThis}
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

      <h2 className={TITLE_CLS}>{t.s1Title}</h2>
      <p className={P_CLS}>{t.s1Body}</p>

      <h2 className={TITLE_CLS}>{t.s2Title}</h2>
      <p className={P_CLS}>{t.s2Body}</p>
      <Callout>{t.s2Callout}</Callout>

      <h2 className={TITLE_CLS}>{t.s3Title}</h2>
      <p className={P_CLS}>{t.s3Body}</p>
      <ol className="list-decimal pl-5 space-y-1.5 mb-3">
        {t.s3Steps.map((step, i) => (
          <li key={i} className={LI_CLS}>
            {step}
          </li>
        ))}
      </ol>

      <h2 className={TITLE_CLS}>{t.s4Title}</h2>
      <p className={P_CLS}>{t.s4Body}</p>

      <h2 className={TITLE_CLS}>{t.s5Title}</h2>
      <p className={P_CLS}>{t.s5Body}</p>

      <h2 className={TITLE_CLS}>{t.gmxTitle}</h2>
      <p className={P_CLS}>{t.gmxBody}</p>
      <ol className="list-decimal pl-5 space-y-1.5 mb-3">
        {t.gmxSteps.map((step, i) => (
          <li key={i} className={LI_CLS}>
            {step}
          </li>
        ))}
      </ol>

      <Callout>{t.forwardNote}</Callout>
    </div>
  );
}
