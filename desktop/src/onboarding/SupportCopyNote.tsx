import { useState } from "react";
import { showSupportReportsFolder } from "../lib/onboarding-support";

/**
 * What became of the copy of a report kept on this computer: its file name (never a path, the real folder is the
 * app's own) with a button that shows that folder in the file manager, or the plain statement that the copy
 * could not be kept. `copy` is the report's status lines (SUPPORT_REPORT_COPY).
 */
export function SupportCopyNote({ saved, failed, attach, copy }: { saved?: string | null; failed?: boolean; attach?: boolean; copy: Record<string, string> }) {
  const [shown, setShown] = useState<boolean | null>(null);
  if (failed) return <span data-testid="support-copy-failed">{copy.copyFailed}</span>;
  if (!saved) return null;
  return (
    <span data-testid="support-copy-saved">
      {attach ? copy.saved : copy.copy}: <code>{saved}</code>{" "}
      <button type="button" className="underline" data-testid="support-copy-show" onClick={() => void showSupportReportsFolder().then(setShown)}>{copy.show}</button>
      {shown === false && <> {copy.showFailed}</>}
    </span>
  );
}
