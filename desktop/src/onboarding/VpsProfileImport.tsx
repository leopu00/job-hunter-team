import { FormEvent, useEffect, useRef, useState } from "react";
import SshKeyPicker from "../components/SshKeyPicker";
import { describeError } from "../lib/error-catalog";
import {
  profileImportBridge,
  profileImportErrorCode,
  verifiedProfileImportSnapshot,
  type ProfileImportBridge,
  type VpsProfileImportHost,
} from "../lib/profile-import";
import type { SshHostKeyProbe } from "../lib/onboarding-runtime";
import "./vps-profile-import.css";

type Stage = "closed" | "fields" | "probing" | "confirm" | "importing" | "done" | "failed";

/** The failure, told by the error catalog: what happened and what to do. */
function errorCopy(code: string): { text: string; action: string } {
  return describeError(code, { fallback: "profile_import_failed" });
}

const TERMINAL_ERRORS = new Set([
  "source_profile_missing",
  "source_profile_invalid",
  "source_review_pending",
  "target_profile_exists",
  "profile_import_recovery_required",
  "local_profile_required",
  "host_key_changed",
  "host_key_mismatch",
]);

function initialHost(): VpsProfileImportHost {
  return { kind: "vps", address: "", user: "root", port: 22, keyPath: "" };
}

function cleanHost(host: VpsProfileImportHost): VpsProfileImportHost {
  return { ...host, address: host.address.trim(), user: host.user.trim(), keyPath: host.keyPath.trim() };
}

function validHost(host: VpsProfileImportHost): boolean {
  return Boolean(host.address.trim() && host.user.trim() && host.keyPath.trim() &&
    Number.isInteger(host.port) && host.port > 0 && host.port <= 65_535);
}

export interface VpsProfileImportProps {
  bridge?: ProfileImportBridge;
}

export default function VpsProfileImport({ bridge = profileImportBridge }: VpsProfileImportProps) {
  const [stage, setStage] = useState<Stage>("closed");
  const [host, setHost] = useState<VpsProfileImportHost>(initialHost);
  const [probe, setProbe] = useState<SshHostKeyProbe | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busy = stage === "probing" || stage === "importing";

  useEffect(() => {
    if (["confirm", "failed", "done"].includes(stage)) headingRef.current?.focus();
  }, [stage]);

  function edit() {
    setProbe(null);
    setErrorCode(null);
    setStage("fields");
  }

  function close() {
    if (busy) return;
    setHost(initialHost());
    setProbe(null);
    setErrorCode(null);
    setStage("closed");
  }

  function fail(error: unknown) {
    setErrorCode(profileImportErrorCode(error));
    setStage("failed");
  }

  async function importVerifiedHost() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setStage("importing");
    setErrorCode(null);
    try {
      const snapshot = await bridge.importProfile(cleanHost(host));
      if (!verifiedProfileImportSnapshot(snapshot)) throw { code: "receipt_unverified" };
      setStage("done");
    } catch (error) {
      fail(error);
    } finally {
      pendingRef.current = false;
    }
  }

  async function probeHost(event?: FormEvent) {
    event?.preventDefault();
    if (!validHost(host) || pendingRef.current) return;
    pendingRef.current = true;
    setStage("probing");
    setErrorCode(null);
    try {
      const next = await bridge.probe(cleanHost(host));
      setProbe(next);
      if (next.status === "pinned") {
        pendingRef.current = false;
        await importVerifiedHost();
        return;
      }
      setStage("confirm");
    } catch (error) {
      fail(error);
    } finally {
      pendingRef.current = false;
    }
  }

  async function confirmAndImport() {
    if (!probe || pendingRef.current) return;
    pendingRef.current = true;
    setStage("importing");
    setErrorCode(null);
    try {
      await bridge.confirm(cleanHost(host), probe);
      pendingRef.current = false;
      await importVerifiedHost();
    } catch (error) {
      fail(error);
    } finally {
      pendingRef.current = false;
    }
  }

  if (stage === "closed") {
    return (
      <section className="vps-profile-import vps-profile-import--closed">
        <div><strong>Hai già un profilo su una VPS?</strong><p>Puoi copiarlo qui senza collegare Google.</p></div>
        <button type="button" onClick={() => setStage("fields")}>Importa profilo</button>
      </section>
    );
  }

  if (stage === "done") {
    return (
      <section className="vps-profile-import vps-profile-import--done" role="status" aria-live="polite">
        <span aria-hidden="true">✓</span><div><h3 ref={headingRef} tabIndex={-1}>Profilo importato.</h3><p>La copia locale è stata verificata ed è pronta per questo team.</p></div>
      </section>
    );
  }

  return (
    <section className="vps-profile-import" aria-busy={busy}>
      <header><p className="onboarding-eyebrow">Importazione protetta</p><h3 ref={stage === "confirm" ? headingRef : undefined} tabIndex={stage === "confirm" ? -1 : undefined}>Riusa il profilo della tua VPS.</h3><p>Leggiamo soltanto il profilo confermato. Chiavi, database e configurazioni restano dove sono.</p></header>

      {(stage === "fields" || stage === "probing") && (
        <form onSubmit={(event) => void probeHost(event)}>
          <label><span>Host o indirizzo IP</span><input autoFocus autoComplete="off" value={host.address} onChange={(event) => setHost({ ...host, address: event.target.value })} disabled={busy} required /></label>
          <div className="vps-profile-import__row">
            <label><span>Utente SSH</span><input autoComplete="username" value={host.user} onChange={(event) => setHost({ ...host, user: event.target.value })} disabled={busy} required /></label>
            <label><span>Porta SSH</span><input type="number" min="1" max="65535" inputMode="numeric" value={host.port} onChange={(event) => setHost({ ...host, port: Number(event.target.value) })} disabled={busy} required /></label>
          </div>
          <SshKeyPicker value={host.keyPath} onChange={(keyPath) => setHost({ ...host, keyPath })} disabled={busy} />
          <div className="vps-profile-import__actions"><button type="button" className="onboarding-secondary" onClick={close} disabled={busy}>Annulla</button><button type="submit" className="onboarding-primary" disabled={!validHost(host) || busy}>{busy ? "Verifica in corso…" : "Verifica e importa"}</button></div>
        </form>
      )}

      {stage === "confirm" && probe && (
        <section className="vps-profile-import__confirm" aria-live="polite">
          <p>Confronta il fingerprint con quello mostrato dal provider della VPS.</p>
          <dl><div><dt>Algoritmo</dt><dd>{probe.algorithm}</dd></div><div><dt>Fingerprint</dt><dd>{probe.fingerprint}</dd></div></dl>
          <div className="vps-profile-import__actions"><button type="button" className="onboarding-secondary" onClick={edit}>Indietro</button><button type="button" className="onboarding-primary" onClick={() => void confirmAndImport()}>Conferma e importa</button></div>
        </section>
      )}

      {stage === "importing" && <p className="vps-profile-import__status" role="status" aria-live="polite">Importazione e verifica della copia locale in corso…</p>}

      {stage === "failed" && errorCode && (
        <section className="vps-profile-import__failure" role="alert">
          <h3 ref={headingRef} tabIndex={-1}>Importazione non completata</h3><p>{errorCopy(errorCode).text}</p><p>{errorCopy(errorCode).action}</p>
          <div className="vps-profile-import__actions"><button type="button" className="onboarding-secondary" onClick={close}>Chiudi</button>{!TERMINAL_ERRORS.has(errorCode) && <button type="button" className="onboarding-primary" onClick={edit}>Modifica e riprova</button>}</div>
        </section>
      )}
    </section>
  );
}
