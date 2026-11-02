import { useEffect, useState } from "react";

export type PendingSetup = { profile: boolean; team: boolean };

/** The same sessionStorage key and event as the web's NavLinks: the onboarding writes them, the navbar shows the «!». */
const PENDING_KEY = "onboarding-popup:pending";
const EVENT_NAME = "onboarding-popup-update";

const NONE: PendingSetup = { profile: false, team: false };

function read(): PendingSetup {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return NONE;
    const value = JSON.parse(raw);
    return { profile: !!value.profile, team: !!value.team };
  } catch {
    return NONE;
  }
}

export function usePendingSetup(): PendingSetup {
  const [pending, setPending] = useState<PendingSetup>(NONE);
  useEffect(() => {
    setPending(read());
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<PendingSetup>).detail;
      setPending(detail ? { profile: !!detail.profile, team: !!detail.team } : read());
    };
    window.addEventListener(EVENT_NAME, onUpdate);
    return () => window.removeEventListener(EVENT_NAME, onUpdate);
  }, []);
  return pending;
}
