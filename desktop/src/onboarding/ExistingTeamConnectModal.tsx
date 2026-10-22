import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import SshKeyPicker from "../components/SshKeyPicker";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import {
  existingTeamBridge,
  existingTeamErrorCode,
  isTerminalExistingTeamError,
  type ExistingTeamBridge,
  type ExistingTeamConnectionResult,
  type ExistingTeamReadOnlyConnectionResult,
  type ExistingTeamProgress,
  type ExistingTeamReceipt,
  type ExistingTeamRequest,
  type ExistingTeamVpsHost,
  type SshHostKeyProbe,
} from "../lib/existing-team";
import { EXISTING_TEAM_ID_TEXT } from "./existing-team-id.i18n";
import { EXISTING_TEAM_RECEIPT_TEXT } from "./existing-team-receipt.i18n";
import { OnboardingArtwork } from "./OnboardingArtwork";
import "./existing-team-connect.css";

type ModalStage = "fields" | "probing" | "confirm" | "attaching" | "discovering" | "receipt" | "registering" | "failed";
type FailedOperation = "probe" | "attach" | "notify";

export interface ExistingTeamConnectModalProps {
  teamId?: string;
  initialHost?: ExistingTeamVpsHost;
  onCancel: () => void;
  onConnected: (result: ExistingTeamConnectionResult) => Promise<void>;
  /** The team was connected to read only: the app shows its positions in place of this dialog. */
  onReadOnlyConnected: (result: ExistingTeamReadOnlyConnectionResult) => void;
  bridge?: ExistingTeamBridge;
}

/** The failure, told by the error catalog: what happened and what to do. */
function errorCopy(code: string): { text: string; action: string } {
  return describeError(code, { fallback: "existing_team_connect_failed", locale: appLocale() });
}

/** A target for this profile is already saved (here or by whoever got there first): never replace it. */
function targetAlreadySaved(error: unknown): boolean {
  const code = existingTeamErrorCode(error);
  return code === "existing_team_runtime_candidate_exists" ||
    code === "existing_team_runtime_candidate_conflict" ||
    code === "existing_team_runtime_already_selected";
}

/** A short form of an identifier for the person to compare; the full value stays in the app. */
function shortId(value: string): string {
  return value.replace(/^sha256:/, "").slice(0, 12);
}

function cleanHost(host: ExistingTeamVpsHost): ExistingTeamVpsHost {
  return {
    ...host,
    address: host.address.trim(),
    user: host.user.trim(),
    keyPath: host.keyPath.trim(),
  };
}

function validHost(host: ExistingTeamVpsHost): boolean {
  return Boolean(host.address.trim() && host.user.trim() && host.keyPath.trim() &&
    Number.isInteger(host.port) && host.port > 0 && host.port <= 65_535);
}

function focusable(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export default function ExistingTeamConnectModal({
  teamId,
  initialHost,
  onCancel,
  onConnected,
  onReadOnlyConnected,
  bridge = existingTeamBridge,
}: ExistingTeamConnectModalProps) {
  const t = ONBOARDING_TEXT[appLocale()];
  const r = EXISTING_TEAM_RECEIPT_TEXT[appLocale()];
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<ExistingTeamConnectionResult | null>(null);
  const registerInFlight = useRef(false);
  const [host, setHost] = useState<ExistingTeamVpsHost>(initialHost ?? {
    kind: "vps",
    address: "",
    user: "",
    port: 22,
    keyPath: "",
  });
  const [enteredTeamId, setEnteredTeamId] = useState("");
  const expectedTeamId = teamId ?? enteredTeamId.trim();
  const teamIdValid = /^[A-Za-z0-9_-]{16,128}$/.test(expectedTeamId);
  const [stage, setStage] = useState<ModalStage>("fields");
  const [probe, setProbe] = useState<SshHostKeyProbe | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [failedOperation, setFailedOperation] = useState<FailedOperation | null>(null);
  const [readOnlyRequested, setReadOnlyRequested] = useState(false);
  const [receipt, setReceipt] = useState<ExistingTeamReceipt | null>(null);
  const [attachProgress, setAttachProgress] = useState<ExistingTeamProgress["stage"]>("runtime");
  const terminal = errorCode ? isTerminalExistingTeamError(errorCode) : false;

  useEffect(() => {
    if (stage !== "fields") headingRef.current?.focus();
  }, [stage]);

  function backToFields() {
    resultRef.current = null;
    setReceipt(null);
    setProbe(null);
    setErrorCode(null);
    setFailedOperation(null);
    setStage("fields");
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (stage === "confirm" || stage === "receipt" || stage === "failed") backToFields();
      else if (stage === "fields") onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const items = focusable(dialogRef.current);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function runProbe() {
    if (!validHost(host) || !teamIdValid || stage === "probing") return;
    setStage("probing");
    setErrorCode(null);
    setFailedOperation(null);
    try {
      const next = await bridge.probe(cleanHost(host));
      setProbe(next);
      setStage("confirm");
    } catch (error) {
      setErrorCode(existingTeamErrorCode(error));
      setFailedOperation("probe");
      setStage("failed");
    }
  }

  async function notify(result: ExistingTeamConnectionResult) {
    try {
      await onConnected(result);
    } catch (error) {
      setErrorCode(existingTeamErrorCode(error));
      setFailedOperation("notify");
      setStage("failed");
    }
  }

  /**
   * A target for this profile exists by now. Never open it blindly: connect read
   * only with what the person typed. If it is the same team and host that
   * works; if not, the native check answers candidate_mismatch, which the
   * dialog shows, instead of showing another team in silence.
   */
  async function openSavedTarget(request: ExistingTeamRequest) {
    onReadOnlyConnected(await bridge.connectReadOnly(request));
  }

  /**
   * Read only: the existing connection first. Only if the profile has no saved
   * target does the app read what the server declares and ask the person to
   * confirm before it saves anything.
   */
  async function openReadOnly(request: ExistingTeamRequest) {
    try {
      onReadOnlyConnected(await bridge.connectReadOnly(request));
      return;
    } catch (error) {
      if (existingTeamErrorCode(error) !== "existing_team_runtime_candidate_required") throw error;
    }
    setStage("discovering");
    try {
      setReceipt(await bridge.discover(request));
    } catch (error) {
      if (!targetAlreadySaved(error)) throw error;
      await openSavedTarget(request);
      return;
    }
    setStage("receipt");
  }

  /** The full connection («Confirm and connect»), with the target this profile has saved. */
  async function connectFull(request: ExistingTeamRequest) {
    setStage("attaching");
    const result = await bridge.connect(request, (progress) => setAttachProgress(progress.stage));
    resultRef.current = result;
    await notify(result);
  }

  /**
   * «Confirm and connect» on a profile with no saved target: the same steps as the read-only
   * opening (what the server declares, the person's confirmation, the saved target), then the full
   * connection. With a target already saved it connects at once, as it always did.
   */
  async function openFull(request: ExistingTeamRequest) {
    try {
      await connectFull(request);
      return;
    } catch (error) {
      if (existingTeamErrorCode(error) !== "existing_team_runtime_candidate_required") throw error;
    }
    setStage("discovering");
    try {
      setReceipt(await bridge.discover(request));
    } catch (error) {
      if (!targetAlreadySaved(error)) throw error;
      await connectFull(request);
      return;
    }
    setStage("receipt");
  }

  async function registerReceipt() {
    if (!receipt || stage !== "receipt" || registerInFlight.current) return;
    registerInFlight.current = true;
    const request = { teamId: expectedTeamId, host: cleanHost(host) };
    // the button the person pressed decides what follows the saved target: read only, or in full
    const readOnly = readOnlyRequested;
    setStage("registering");
    setErrorCode(null);
    setFailedOperation(null);
    try {
      try {
        await bridge.register(receipt.candidateSha256);
      } catch (error) {
        if (!targetAlreadySaved(error)) throw error;
        if (readOnly) await openSavedTarget(request);
        else await connectFull(request);
        return;
      }
      if (readOnly) onReadOnlyConnected(await bridge.connectReadOnly(request));
      else await connectFull(request);
    } catch (error) {
      setErrorCode(existingTeamErrorCode(error));
      setFailedOperation("attach");
      setStage("failed");
    } finally {
      registerInFlight.current = false;
    }
  }

  async function attach(readOnly = false) {
    if (!probe || !teamIdValid || stage === "attaching") return;
    const request = { teamId: expectedTeamId, host: cleanHost(host) };
    setReadOnlyRequested(readOnly);
    setStage("attaching");
    setErrorCode(null);
    setFailedOperation(null);
    try {
      await bridge.confirm(request.host, probe);
      if (readOnly) {
        await openReadOnly(request);
        return;
      }
      await openFull(request);
    } catch (error) {
      setErrorCode(existingTeamErrorCode(error));
      setFailedOperation("attach");
      setStage("failed");
    }
  }

  async function retry() {
    if (failedOperation === "probe") return runProbe();
    if (failedOperation === "notify" && resultRef.current) {
      setStage("attaching");
      setErrorCode(null);
      return notify(resultRef.current);
    }
    if (failedOperation === "attach") {
      setStage("confirm");
      return attach(readOnlyRequested);
    }
  }

  const busy = stage === "probing" || stage === "attaching" || stage === "discovering" || stage === "registering";
  const activeStep = stage === "fields" || stage === "probing" ? 0 : stage === "confirm" ? 1 : 2;
  const progressCopy: Record<ExistingTeamProgress["stage"], string> = t.existingTeam.progress;

  return (
    <div className="existing-team-modal__backdrop">
      <section
        ref={dialogRef}
        className="existing-team-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        onKeyDown={keyDown}
      >
        <header className="existing-team-modal__header">
          <p className="existing-team-modal__eyebrow">{t.existingTeam.eyebrow}</p>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{t.existingTeam.title}</h2>
          <p id={descriptionId}>{t.existingTeam.description}</p>
        </header>

        <OnboardingArtwork name="environmentVps" className="existing-team-modal__artwork" />

        <ol className="existing-team-modal__steps" aria-label={t.existingTeam.stepsAria}>
          {t.existingTeam.steps.map((label, index) => (
            <li key={label} className={index < activeStep ? "is-complete" : index === activeStep ? "is-active" : undefined} aria-current={index === activeStep ? "step" : undefined}>
              <span aria-hidden="true">{index < activeStep ? "✓" : index + 1}</span>{label}
            </li>
          ))}
        </ol>

        {(stage === "fields" || stage === "probing") && (
          <form className="existing-team-modal__form" onSubmit={(event) => { event.preventDefault(); void runProbe(); }}>
            {!teamId && <label><span>{EXISTING_TEAM_ID_TEXT[appLocale()].label}</span><input autoComplete="off" value={enteredTeamId} onChange={(event) => setEnteredTeamId(event.target.value)} disabled={busy} required /><small>{EXISTING_TEAM_ID_TEXT[appLocale()].hint}</small></label>}
            <label><span>{t.existingTeam.host}</span><input autoFocus autoComplete="off" value={host.address} onChange={(event) => setHost({ ...host, address: event.target.value })} disabled={busy} required /></label>
            <div className="existing-team-modal__row">
              <label><span>{t.sshUser}</span><input autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={t.sshUserPlaceholder} value={host.user} onChange={(event) => setHost({ ...host, user: event.target.value })} disabled={busy} required /></label>
              <label><span>{t.sshPort}</span><input type="number" min="1" max="65535" inputMode="numeric" value={host.port} onChange={(event) => setHost({ ...host, port: Number(event.target.value) })} disabled={busy} required /></label>
            </div>
            <SshKeyPicker value={host.keyPath} onChange={(keyPath) => setHost({ ...host, keyPath })} disabled={busy} />
            <div className="existing-team-modal__actions">
              <button type="button" className="existing-team-modal__secondary" onClick={onCancel} disabled={busy}>{t.existingTeam.newTeam}</button>
              <button type="submit" className="existing-team-modal__primary" disabled={!validHost(host) || !teamIdValid || busy}>{stage === "probing" ? t.existingTeam.verifyingIdentity : t.existingTeam.verifyVps}</button>
            </div>
          </form>
        )}

        {stage === "confirm" && probe && (
          <section className="existing-team-modal__confirm" aria-live="polite">
            <p className="existing-team-modal__eyebrow">{t.existingTeam.confirmEyebrow}</p>
            <p>{t.existingTeam.compareText}</p>
            <dl><div><dt>{t.algorithm}</dt><dd>{probe.algorithm}</dd></div><div><dt>{t.fingerprint}</dt><dd>{probe.fingerprint}</dd></div></dl>
            <p className="existing-team-modal__warning">{t.existingTeam.warning}</p>
            <div className="existing-team-modal__actions">
              <button type="button" className="existing-team-modal__secondary" onClick={backToFields}>{t.back}</button>
              <button type="button" className="existing-team-modal__primary" onClick={() => void attach()}>{t.existingTeam.confirmAndLink}</button>
              <button type="button" className="existing-team-modal__secondary" onClick={() => void attach(true)}>{t.existingTeam.readOnlyPositions}</button>
            </div>
          </section>
        )}

        {stage === "attaching" && (
          <section className="existing-team-modal__status" role="status" aria-live="polite">
            <span aria-hidden="true">••</span><div><strong>{t.existingTeam.attachInProgress}</strong><p>{progressCopy[attachProgress]}</p></div>
          </section>
        )}

        {stage === "discovering" && (
          <section className="existing-team-modal__status" role="status" aria-live="polite">
            <span aria-hidden="true">••</span><div><strong>{r.discovering}</strong><p>{r.discoveringDetail}</p></div>
          </section>
        )}

        {stage === "receipt" && receipt && (
          <section className="existing-team-modal__confirm" aria-live="polite">
            <p className="existing-team-modal__eyebrow">{r.eyebrow}</p>
            <p>{r.intro}</p>
            <dl>
              <div><dt>{r.team}</dt><dd>{receipt.teamId}</dd></div>
              <div><dt>{r.vps}</dt><dd>{receipt.hostAddress}:{receipt.hostPort}</dd></div>
              {receipt.sshFingerprint && <div><dt>{r.fingerprint}</dt><dd>{receipt.sshFingerprint}</dd></div>}
              <div><dt>{r.container}</dt><dd>{shortId(receipt.containerId)}</dd></div>
              <div><dt>{r.image}</dt><dd>{shortId(receipt.imageId)}</dd></div>
              <div><dt>{r.revision}</dt><dd>{shortId(receipt.ociRevision)}</dd></div>
              <div><dt>{r.digest}</dt><dd>{shortId(receipt.digest)}</dd></div>
              <div><dt>{r.assistant}</dt><dd>{receipt.readiness ? r.assistantUp : r.assistantDown}</dd></div>
            </dl>
            <p className="existing-team-modal__warning">{readOnlyRequested ? r.caution : r.cautionFull}</p>
            <div className="existing-team-modal__actions">
              <button type="button" className="existing-team-modal__secondary" onClick={backToFields}>{r.cancel}</button>
              <button type="button" className="existing-team-modal__primary" onClick={() => void registerReceipt()}>{readOnlyRequested ? r.confirm : t.existingTeam.confirmAndLink}</button>
            </div>
          </section>
        )}

        {stage === "registering" && (
          <section className="existing-team-modal__status" role="status" aria-live="polite">
            <span aria-hidden="true">••</span><div><strong>{r.registering}</strong><p>{readOnlyRequested ? r.registeringDetail : r.registeringDetailFull}</p></div>
          </section>
        )}

        {stage === "failed" && errorCode && (
          <section className={`existing-team-modal__failure${terminal ? " is-terminal" : ""}`} role="alert">
            <strong>{terminal ? t.existingTeam.blocked : t.existingTeam.failed}</strong>
            <p>{errorCopy(errorCode).text}</p>
            <p>{errorCopy(errorCode).action}</p>
            <div className="existing-team-modal__actions">
              <button type="button" className="existing-team-modal__secondary" onClick={terminal ? onCancel : backToFields}>{terminal ? t.existingTeam.backToSetup : t.existingTeam.editData}</button>
              {!terminal && <button type="button" className="existing-team-modal__primary" onClick={() => void retry()}>{t.retry}</button>}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
