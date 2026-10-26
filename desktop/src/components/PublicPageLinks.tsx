import { useState } from "react";
import { appLocale } from "../lib/app-locale";
import { openPublicPage, PUBLIC_PAGE_TEXT } from "../lib/public-pages";

/** Privacy notice and terms, in the person's browser: the same two pages the website links. */
export default function PublicPageLinks({ className }: { className?: string }) {
  const t = PUBLIC_PAGE_TEXT[appLocale()];
  const [failed, setFailed] = useState(false);
  const open = async (page: "privacy" | "terms") => setFailed(!(await openPublicPage(page)));
  return (
    <p data-testid="public-page-links" className={className}>
      <button type="button" className="underline" onClick={() => void open("privacy")}>{t.privacy}</button>
      {" · "}
      <button type="button" className="underline" onClick={() => void open("terms")}>{t.terms}</button>
      {failed && <span role="alert"> {t.failed}</span>}
    </p>
  );
}
