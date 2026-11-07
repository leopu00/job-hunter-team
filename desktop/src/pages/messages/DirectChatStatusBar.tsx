import { useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { useTeamOff } from "../../lib/team-off";
import { StartTeamAction } from "../../shell/StartTeamAction";
import { useChooseDestination } from "../../lib/choose-destination";
import { NO_DESTINATION_CODES } from "../../shell/VpsLinkBar";
import { VPS_LINK_TEXT } from "../../lib/vps-link.i18n";
import { DIRECT_CHAT_TEXT } from "./direct-chat.i18n";
import { safeCode } from "./direct-chat-screen-helpers";
import type { DirectChatStatus } from "./direct-chat-contract";
const CONNECTING_SLOW_MS = 8_000;
type StatusProps = {
  status: DirectChatStatus;
  operationError: string | null;
  reconnecting: boolean;
  agentLine: string | null;
  onRetry: () => void;
  onReadAgain: () => Promise<boolean>;
};
function useStatusBarModel({ status, operationError, reconnecting, agentLine }: StatusProps) {
  const locale = appLocale();
  const t = DIRECT_CHAT_TEXT[locale];
  const [slow, setSlow] = useState(false);
  const teamOff = useTeamOff();
  const connecting = status.state === "connecting";
  useEffect(() => {
    setSlow(false);
    if (!connecting) return;
    const timer = setTimeout(() => setSlow(true), CONNECTING_SLOW_MS);
    return () => clearTimeout(timer);
  }, [connecting]);
  const stuck = connecting && slow && !reconnecting;
  const failed = status.state === "error" || status.state === "disconnected" || stuck;
  const code = safeCode(operationError ?? status.code);
  let text = stuck ? t.connectingSlow : t.connecting;
  if (status.state === "ready") text = agentLine ?? t.connected;
  if (status.state === "disconnected") text = t.disconnected;
  if (status.state === "error") text = t.unavailable;
  if (operationError) text = t.operationFailed;
  // A code the catalog knows is told with its sentence and action; the raw
  // code is never shown.
  const described = (failed || operationError) && code ? describeError(code, { locale }) : null;
  if (described?.known) text = `${described.text} ${described.action}`;
  // The team of this computer is stopped: the sentence says «start the team», so the bar offers it (the
  // app opened without the team has it in the banner above).
  const teamStopped = (failed || operationError) && code === "local_team_not_running" && !teamOff;
  // The saved destination of the team is gone: asking again gets the same refusal, so the bar offers what
  // helps (choose where the team runs) instead of «Try again», and takes the person there at once.
  const chooseDestination = useChooseDestination();
  const noDestination = Boolean((failed || operationError) && code && NO_DESTINATION_CODES.includes(code) && chooseDestination);
  useEffect(() => {
    if (noDestination) chooseDestination?.();
  }, [noDestination, chooseDestination]);


  return { locale, t, failed, text, teamStopped, noDestination, chooseDestination };
}
export function StatusBar(props: StatusProps) {
  const { operationError, reconnecting, onRetry, onReadAgain } = props;
  const { locale, t, failed, text, teamStopped, noDestination, chooseDestination } = useStatusBarModel(props);
  return (
    <div
      className="shrink-0 min-h-9 px-4 py-2 flex items-center justify-between gap-3 border-b border-[var(--color-border)] text-[14px]"
      role={failed || operationError ? "alert" : "status"}
      data-testid="direct-chat-status"
      style={{ color: failed || operationError ? "var(--color-red)" : "var(--color-muted)" }}
    >
      <span>
        {text}
      </span>
      {(failed || operationError) && (
        <span className="shrink-0 flex items-center gap-2">
          {teamStopped && <StartTeamAction onStarted={onReadAgain} />}
          {noDestination ? (
            <button
              type="button"
              data-testid="direct-chat-choose-destination"
              onClick={chooseDestination ?? undefined}
              className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[14px] font-semibold text-[var(--color-bright)]"
            >
              {VPS_LINK_TEXT[locale].chooseDestination}
            </button>
          ) : (
            <button
              type="button"
              onClick={onRetry}
              disabled={reconnecting}
              className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[14px] font-semibold text-[var(--color-bright)] disabled:opacity-50"
            >
              {reconnecting ? t.reconnecting : t.retry}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
