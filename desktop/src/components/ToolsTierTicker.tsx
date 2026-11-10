import { useEffect, useRef, useState } from "react";
import { appLocale } from "../lib/app-locale";
import { runtimeText } from "../lib/onboarding-runtime.i18n";
import { toolsTierDelay, toolsTierTextKey, toolsTierTick, type ToolsTier } from "../lib/tools-tier";

const READY_SHOWN_MS = 8_000;

/**
 * Keeps the tools of the runtime moving while the app is open (the host pulls the full image in the background and
 * switches to it once the onboarding has closed: tools_tier.rs) and says, in one line in a corner, that they are
 * arriving and when the team has moved onto them. Nothing here decides anything: it asks the app for a round.
 * `tick` is for the tests.
 */
export default function ToolsTierTicker({ tick = toolsTierTick }: { tick?: () => Promise<ToolsTier | null> }) {
  const [seen, setSeen] = useState<ToolsTier | null>(null);
  const [switched, setSwitched] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hide: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;
    const round = async () => {
      const answer = await tick();
      if (!alive.current) return;
      setSeen(answer);
      if (answer?.message === "ui_phase_tools_ready") {
        setSwitched(true);
        hide = setTimeout(() => alive.current && setSwitched(false), READY_SHOWN_MS);
      }
      misses = answer ? 0 : misses + 1;
      const delay = toolsTierDelay(answer, misses);
      if (delay !== null) timer = setTimeout(round, delay);
    };
    void round();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
      if (hide) clearTimeout(hide);
    };
  }, [tick]);

  const key = toolsTierTextKey(seen, switched);
  if (!key) return null;
  return (
    <div
      role="status"
      className="fixed bottom-3 left-3 z-40 max-w-xs rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[11px] text-[var(--color-muted)] shadow"
    >
      {runtimeText(key, appLocale())}
    </div>
  );
}
