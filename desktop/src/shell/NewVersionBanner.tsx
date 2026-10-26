import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { dismissedVersion, dismissVersion, newerVersion, UPDATE_TEXT } from "../lib/app-update";
import { openPublicPage } from "../lib/public-pages";

/**
 * A line at the top while a newer public release exists. It asks once at startup, opens the download page in the
 * person's browser and can be closed for that version. It does not download or install anything.
 */
export function NewVersionBanner({ check = newerVersion, locale: localeOverride }: { check?: () => Promise<string | null>; locale?: Locale }) {
  const text = UPDATE_TEXT[localeOverride ?? appLocale()];
  const [version, setVersion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    check()
      .then((found) => {
        if (live && found && found !== dismissedVersion()) setVersion(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [check]);

  if (!version) return null;
  return (
    <div
      role="status"
      data-testid="new-version-banner"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <strong>{text.message.replace("{version}", version)}</strong>
      {failed && <span role="alert" className="text-[var(--color-muted)]">{text.failed}</span>}
      <button
        type="button"
        className="ml-auto px-3 py-1 rounded border border-[var(--color-border)] text-[11px] font-semibold"
        onClick={() => void openPublicPage("download").then((opened) => setFailed(!opened))}
      >
        {text.download}
      </button>
      <button
        type="button"
        className="px-3 py-1 rounded border border-[var(--color-border)] text-[11px]"
        onClick={() => {
          dismissVersion(version);
          setVersion(null);
        }}
      >
        {text.dismiss}
      </button>
    </div>
  );
}
