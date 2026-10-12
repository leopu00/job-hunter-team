import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { ExecutionHost } from "../lib/onboarding";
import { registerAssistanceHost, type AssistanceHost } from "../lib/closer-desktop-connection";
import { confirmOnboardingSshHostKey, probeOnboardingSshHostKey, type SshHostKeyProbe } from "../lib/onboarding-runtime";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import { ASSISTANCE_TEXT } from "./assistance.i18n";

export default function FirstSetupAssistance({ host, locale, onOpen }: {
  host: ExecutionHost; locale: Locale; onOpen: () => void;
}) {
  const t = ASSISTANCE_TEXT[locale], setup = ONBOARDING_TEXT[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<SshHostKeyProbe | null>(null);
  const pending = useRef(false);
  const live = useRef(true);
  const identity = JSON.stringify(host);
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setProbe(null); setError(null); }, [identity]);
  const valid = host.kind === "vps" && Boolean(host.address.trim() && host.user.trim() && host.keyPath.trim())
    && Number.isInteger(host.port) && host.port > 0 && host.port <= 65535;

  async function connect(confirm = false) {
    if (!valid || host.kind !== "vps" || pending.current) return;
    const expected = identity;
    const selected: AssistanceHost = { kind: "vps", address: host.address.trim(), user: host.user.trim(),
      port: host.port, keyPath: host.keyPath.trim() };
    const fresh = () => live.current && current.current === expected;
    pending.current = true; setBusy(true); setError(null);
    try {
      if (confirm) {
        if (!probe) return;
        await confirmOnboardingSshHostKey(selected, probe);
        if (!fresh()) return;
        setProbe(null);
      }
      const result = await registerAssistanceHost(selected);
      if (!fresh()) return;
      if (result.ok) { onOpen(); return; }
      if (result.error === "host_key_missing") {
        const fingerprint = await probeOnboardingSshHostKey(selected);
        if (!fresh()) return;
        if (fingerprint.algorithm !== "ssh-ed25519" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint.fingerprint)) {
          setError("ssh_host_key_invalid"); return;
        }
        // Even an already-pinned probe returns to an explicit user action, never setup.
        setProbe(fingerprint);
      } else setError(result.error);
    } catch {
      if (fresh()) setError("desktop_transport_unavailable");
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }

  return <section className="onboarding-panel" aria-label={t.connect}>
    <p>{t.intro}</p>
    {error && <p role="alert">{t.unavailable} ({error})</p>}
    {probe && <section aria-label={setup.hostKeyAria}>
      <h3>{setup.hostKeyTitle}</h3><p>{setup.hostKeyText}</p>
      <dl><dt>{setup.algorithm}</dt><dd>{probe.algorithm}</dd><dt>{setup.fingerprint}</dt><dd>{probe.fingerprint}</dd></dl>
      <button type="button" disabled={busy} onClick={() => void connect(true)}>{setup.confirmFingerprint}</button>
      <button type="button" disabled={busy} onClick={() => setProbe(null)}>{setup.cancel}</button>
    </section>}
    {!probe && <button className="onboarding-secondary" type="button" disabled={!valid || busy}
      onClick={() => void connect()}>{busy ? t.connecting : t.connect}</button>}
  </section>;
}
