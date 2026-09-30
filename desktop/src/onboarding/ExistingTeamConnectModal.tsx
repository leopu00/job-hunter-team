import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import SshKeyPicker from "../components/SshKeyPicker";
import {
  existingTeamBridge,
  existingTeamErrorCode,
  isTerminalExistingTeamError,
  type ExistingTeamBridge,
  type ExistingTeamConnectionResult,
  type ExistingTeamProgress,
  type ExistingTeamVpsHost,
  type SshHostKeyProbe,
} from "../lib/existing-team";
import "./existing-team-connect.css";

type ModalStage = "fields" | "probing" | "confirm" | "attaching" | "failed";
type FailedOperation = "probe" | "attach" | "notify";

export interface ExistingTeamConnectModalProps {
  teamId: string;
  onCancel: () => void;
  onConnected: (result: ExistingTeamConnectionResult) => Promise<void>;
  bridge?: ExistingTeamBridge;
}

const ERROR_COPY: Record<string, string> = {
  host_key_unavailable: "Non riesco a leggere l’identità SSH della VPS. Controlla host e porta e riprova.",
  host_key_missing: "L’identità SSH della VPS deve essere verificata prima del collegamento.",
  host_key_changed: "L’identità SSH della VPS è cambiata. Per sicurezza il collegamento è stato bloccato.",
  host_key_mismatch: "L’identità SSH non corrisponde a quella già confermata. Il collegamento è bloccato.",
  host_key_confirmation_invalid: "La conferma dell’identità SSH non è valida. Torna ai dati della VPS e riprova.",
  host_key_unwritable: "Non riesco a salvare localmente l’identità SSH confermata.",
  permissions_failed: "Non riesco a proteggere localmente l’identità SSH confermata.",
  not_vps: "Per questo collegamento serve una VPS.",
  invalid_host: "L’host VPS non è valido.",
  invalid_user: "L’utente SSH non è valido.",
  invalid_key_path: "Il percorso della chiave SSH non è valido.",
  key_unavailable: "Il file chiave SSH selezionato non è disponibile.",
  invalid_key: "Il file chiave SSH selezionato non è valido.",
  invalid_port: "La porta SSH non è valida.",
  invalid_team_id: "Il riferimento del team non è valido.",
  existing_team_vps_required: "Per collegare il team esistente serve una configurazione VPS valida.",
  existing_team_identity_mismatch: "Il team trovato sulla VPS non corrisponde al team registrato per questo account.",
  existing_team_not_active: "Il team registrato non risulta attivo sulla VPS.",
  existing_team_unavailable: "La VPS o il runtime Job Hunter Team non sono raggiungibili.",
  account_team_mismatch: "Il team trovato non appartiene a questo account Google.",
  ssh_unavailable: "La VPS non è raggiungibile tramite SSH. Controlla la connessione e riprova.",
  ssh_auth_failed: "L’accesso SSH non è riuscito. Controlla utente e chiave e riprova.",
  snapshot_failed: "Il team risponde, ma il suo stato non può essere verificato.",
  container_unavailable: "Il team registrato non risulta attivo sulla VPS.",
  operation_in_progress: "È già in corso una verifica. Attendi e riprova.",
  unknown: "Il collegamento non è riuscito. Nessun dato sensibile è stato salvato: riprova.",
};

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
  onCancel,
  onConnected,
  bridge = existingTeamBridge,
}: ExistingTeamConnectModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<ExistingTeamConnectionResult | null>(null);
  const [host, setHost] = useState<ExistingTeamVpsHost>({
    kind: "vps",
    address: "",
    user: "root",
    port: 22,
    keyPath: "",
  });
  const [stage, setStage] = useState<ModalStage>("fields");
  const [probe, setProbe] = useState<SshHostKeyProbe | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [failedOperation, setFailedOperation] = useState<FailedOperation | null>(null);
  const [attachProgress, setAttachProgress] = useState<ExistingTeamProgress["stage"]>("runtime");
  const terminal = errorCode ? isTerminalExistingTeamError(errorCode) : false;

  useEffect(() => {
    if (stage !== "fields") headingRef.current?.focus();
  }, [stage]);

  function backToFields() {
    resultRef.current = null;
    setProbe(null);
    setErrorCode(null);
    setFailedOperation(null);
    setStage("fields");
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (stage === "confirm" || stage === "failed") backToFields();
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
    if (!validHost(host) || stage === "probing") return;
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

  async function attach() {
    if (!probe || stage === "attaching") return;
    const request = { teamId, host: cleanHost(host) };
    setStage("attaching");
    setErrorCode(null);
    setFailedOperation(null);
    try {
      await bridge.confirm(request.host, probe);
      const result = await bridge.connect(request, (progress) => setAttachProgress(progress.stage));
      resultRef.current = result;
      await notify(result);
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
      return attach();
    }
  }

  const busy = stage === "probing" || stage === "attaching";
  const activeStep = stage === "fields" || stage === "probing" ? 0 : stage === "confirm" ? 1 : 2;
  const progressCopy: Record<ExistingTeamProgress["stage"], string> = {
    preparing: "Preparo la verifica attach-only.",
    runtime: "Verifico la VPS già configurata.",
    container: "Controllo runtime e container senza modificarli.",
    provider: "Controllo il provider già configurato.",
    team: "Verifico che Capitano e Assistente siano attivi.",
  };

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
          <p className="existing-team-modal__eyebrow">Team registrato</p>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>Hai già un team attivo su VPS?</h2>
          <p id={descriptionId}>Collega questa app senza reinstallare o riavviare il team. Host e chiave restano soltanto su questo computer.</p>
        </header>

        <ol className="existing-team-modal__steps" aria-label="Avanzamento collegamento VPS">
          {["Dati VPS", "Identità SSH", "Verifica team"].map((label, index) => (
            <li key={label} className={index < activeStep ? "is-complete" : index === activeStep ? "is-active" : undefined} aria-current={index === activeStep ? "step" : undefined}>
              <span aria-hidden="true">{index < activeStep ? "✓" : index + 1}</span>{label}
            </li>
          ))}
        </ol>

        {(stage === "fields" || stage === "probing") && (
          <form className="existing-team-modal__form" onSubmit={(event) => { event.preventDefault(); void runProbe(); }}>
            <label><span>Host o indirizzo IP</span><input autoFocus autoComplete="off" value={host.address} onChange={(event) => setHost({ ...host, address: event.target.value })} disabled={busy} required /></label>
            <div className="existing-team-modal__row">
              <label><span>Utente SSH</span><input autoComplete="username" value={host.user} onChange={(event) => setHost({ ...host, user: event.target.value })} disabled={busy} required /></label>
              <label><span>Porta SSH</span><input type="number" min="1" max="65535" inputMode="numeric" value={host.port} onChange={(event) => setHost({ ...host, port: Number(event.target.value) })} disabled={busy} required /></label>
            </div>
            <SshKeyPicker value={host.keyPath} onChange={(keyPath) => setHost({ ...host, keyPath })} disabled={busy} />
            <div className="existing-team-modal__actions">
              <button type="button" className="existing-team-modal__secondary" onClick={onCancel} disabled={busy}>Configura un nuovo team</button>
              <button type="submit" className="existing-team-modal__primary" disabled={!validHost(host) || busy}>{stage === "probing" ? "Verifico l’identità…" : "Verifica VPS"}</button>
            </div>
          </form>
        )}

        {stage === "confirm" && probe && (
          <section className="existing-team-modal__confirm" aria-live="polite">
            <p className="existing-team-modal__eyebrow">Conferma identità SSH</p>
            <p>Confronta questa impronta con quella mostrata dal tuo provider VPS prima di collegare il team.</p>
            <dl><div><dt>Algoritmo</dt><dd>{probe.algorithm}</dd></div><div><dt>Fingerprint</dt><dd>{probe.fingerprint}</dd></div></dl>
            <p className="existing-team-modal__warning">Conferma soltanto se l’impronta coincide. Il collegamento non installerà né riavvierà nulla.</p>
            <div className="existing-team-modal__actions">
              <button type="button" className="existing-team-modal__secondary" onClick={backToFields}>Indietro</button>
              <button type="button" className="existing-team-modal__primary" onClick={() => void attach()}>Conferma e collega</button>
            </div>
          </section>
        )}

        {stage === "attaching" && (
          <section className="existing-team-modal__status" role="status" aria-live="polite">
            <span aria-hidden="true">••</span><div><strong>Verifica attach-only in corso</strong><p>{progressCopy[attachProgress]}</p></div>
          </section>
        )}

        {stage === "failed" && errorCode && (
          <section className={`existing-team-modal__failure${terminal ? " is-terminal" : ""}`} role="alert">
            <strong>{terminal ? "Collegamento bloccato" : "Verifica non riuscita"}</strong>
            <p>{ERROR_COPY[errorCode] ?? ERROR_COPY.unknown}</p>
            <div className="existing-team-modal__actions">
              <button type="button" className="existing-team-modal__secondary" onClick={terminal ? onCancel : backToFields}>{terminal ? "Torna al setup" : "Modifica dati"}</button>
              {!terminal && <button type="button" className="existing-team-modal__primary" onClick={() => void retry()}>Riprova</button>}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
