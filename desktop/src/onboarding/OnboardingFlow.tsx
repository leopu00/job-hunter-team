import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import SshKeyPicker from "../components/SshKeyPicker";
import type {
  ExecutionHost,
  OnboardingFlowProps,
  OnboardingRuntimeStage,
  SubscriptionProvider,
} from "../lib/onboarding";
import {
  collectionArtwork,
  OnboardingArtwork,
  runtimeArtwork,
} from "./OnboardingArtwork";
import "./onboarding.css";

function emptyVpsHost(): ExecutionHost {
  return { kind: "vps", address: "", user: "root", port: 22, keyPath: "" };
}
const COLLECTION_STEPS = ["Benvenuto", "Ambiente", "Provider", "Conferma"] as const;
const PROVIDERS: Array<{ value: SubscriptionProvider; label: string; vendor: string; mark: string }> = [
  { value: "claude", label: "Claude Code", vendor: "Anthropic · Claude Pro/Max", mark: "CL" },
  { value: "codex", label: "Codex", vendor: "OpenAI · ChatGPT Plus/Pro", mark: "CX" },
  { value: "kimi", label: "Kimi", vendor: "Moonshot · piano Kimi", mark: "KM" },
];
const RUNTIME_STAGES: Array<{ value: OnboardingRuntimeStage; label: string; detail: string }> = [
  { value: "ssh-host-key", label: "Identità server", detail: "Fingerprint SSH verificata" },
  { value: "runtime", label: "Runtime", detail: "Motore container installato e attivo" },
  { value: "container", label: "Container", detail: "Ambiente del team attivo" },
  { value: "provider", label: "Provider", detail: "CLI in abbonamento preparata" },
  { value: "provider-login", label: "Accesso provider", detail: "Login con abbonamento" },
  { value: "team-start", label: "Squadra", detail: "Container e agenti" },
  { value: "assistant", label: "Assistente", detail: "Chat diretta" },
];

function providerName(provider: SubscriptionProvider) {
  return PROVIDERS.find((item) => item.value === provider)?.label ?? provider;
}

function hostName(host: ExecutionHost) {
  return host.kind === "local" ? "Questo computer" : "Server VPS";
}

function moveRadio<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  options: readonly T[],
  current: T | null,
  select: (value: T) => void,
) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const index = current === null ? 0 : Math.max(0, options.indexOf(current));
  const next = options[(index + direction + options.length) % options.length];
  const group = event.currentTarget.closest('[role="radiogroup"]');
  select(next);
  group?.querySelector<HTMLButtonElement>(`[data-radio-value="${next}"]`)?.focus();
}

function ProviderLoginConsole({
  providerLogin,
  onProviderInput,
  onProviderClose,
}: Pick<OnboardingFlowProps, "providerLogin" | "onProviderInput" | "onProviderClose">) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [inputFailed, setInputFailed] = useState(false);
  const [closeFailed, setCloseFailed] = useState(false);
  const active = providerLogin?.status === "active";

  if (!providerLogin) return null;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!active || sending || !input.trim()) return;
    const value = input;
    setSending(true);
    setInputFailed(false);
    try { await onProviderInput(value); setInput(""); } catch { setInputFailed(true); } finally { setSending(false); }
  }

  async function close() {
    if (!active || closing) return;
    setClosing(true);
    setCloseFailed(false);
    try { await onProviderClose(); } catch { setCloseFailed(true); } finally { setClosing(false); }
  }

  return (
    <section className="onboarding-provider-console" aria-label={`Accesso ${providerName(providerLogin.provider)}`}>
      <div className="onboarding-provider-console__heading">
        <div><strong>Sessione {providerName(providerLogin.provider)}</strong><small>Output temporaneo e redatto · non viene salvato</small></div>
        <span>{providerLogin.status === "starting" ? "Apertura…" : providerLogin.status === "active" ? "Attiva" : "Chiusa"}</span>
      </div>
      <pre className="onboarding-provider-console__output" role="log" aria-live="polite" aria-label="Output accesso provider">
        {/* Keep provider-supplied URLs as inert text: never inject terminal output as HTML. */}
        {providerLogin.output || "Attendo le istruzioni del provider…"}
      </pre>
      {providerLogin.provider === "codex" && active && (
        <p className="onboarding-provider-console__help">Apri nel browser l’URL mostrato sopra e inserisci il codice dispositivo.</p>
      )}
      <form className="onboarding-provider-console__input" onSubmit={send}>
        <label htmlFor="provider-login-input">Risposta alla sessione</label>
        <div>
          <input
            id="provider-login-input"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => { setInputFailed(false); setInput(event.target.value); }}
            disabled={!active || sending}
            placeholder={active ? "Scrivi una risposta e premi Invio" : "Sessione non attiva"}
          />
          <button className="onboarding-secondary" type="submit" disabled={!active || sending || !input.trim()}>{sending ? "Invio…" : "Invia"}</button>
          <button className="onboarding-secondary" type="button" onClick={() => void close()} disabled={!active || closing}>{closing ? "Chiusura…" : "Chiudi"}</button>
        </div>
      </form>
      {inputFailed && <p className="onboarding-error" role="alert">Invio non riuscito. La sessione resta aperta: riprova.</p>}
      {closeFailed && <p className="onboarding-error" role="alert">Chiusura non riuscita. Riprova prima di continuare.</p>}
    </section>
  );
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function RuntimeView({ runtime, activity, onRetry, onRestart, onRuntimeAction, providerLogin, sshHostKey, onConfirmHostKey, onCancelHostKey, onProviderInput, onProviderClose }: Pick<OnboardingFlowProps, "runtime" | "activity" | "onRetry" | "onRestart" | "onRuntimeAction" | "providerLogin" | "sshHostKey" | "onConfirmHostKey" | "onCancelHostKey" | "onProviderInput" | "onProviderClose">) {
  const [pending, setPending] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setPending(false);
    setActionFailed(false);
  }, [runtime.status, "stage" in runtime ? runtime.stage : "ready"]);

  useEffect(() => {
    if (!activity || runtime.status !== "working") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activity?.startedAt, runtime.status]);

  if (runtime.status === "ready") {
    return (
      <main className="onboarding-shell onboarding-shell--complete">
        <section className="onboarding-complete" aria-live="polite">
          <OnboardingArtwork name="assistantReady" />
          <span className="onboarding-complete__mark" aria-hidden="true">✓</span>
          <p className="onboarding-eyebrow">Configurazione completata</p>
          <h1>La squadra è pronta.</h1>
          <p>Provider, container e agenti sono stati verificati. Stiamo aprendo la chat con l’Assistente.</p>
          <div className="onboarding-ready-team" aria-label="Agenti pronti">
            {["Capitano", "Scout", "Analista", "Scorer", "Scrittore", "Critico", "Assistente"].map((agent) => <span key={agent}>{agent}</span>)}
          </div>
        </section>
      </main>
    );
  }
  if (runtime.status === "collecting") return null;

  const failed = runtime.status === "failed";
  const actionRequired = runtime.status === "action-required";
  const activeIndex = RUNTIME_STAGES.findIndex((stage) => stage.value === runtime.stage);
  const activeLabel = RUNTIME_STAGES[activeIndex]?.label ?? "Configurazione";
  const completedSteps = Math.max(0, activeIndex);
  const currentActivity = activity?.current?.stage === runtime.stage ? activity.current : undefined;
  const elapsed = activity ? formatElapsed(now - activity.startedAt) : "00:00";

  async function invoke(action: () => Promise<void>) {
    if (pending) return;
    setPending(true); setActionFailed(false);
    try { await action(); } catch { setActionFailed(true); } finally { setPending(false); }
  }

  const actionLabel = runtime.stage === "assistant"
    ? "Apri l’Assistente"
    : runtime.stage === "ssh-host-key" ? "Conferma fingerprint" : "Accedi al provider";
  const action = failed
    ? onRetry
    : runtime.stage === "ssh-host-key" ? onConfirmHostKey : () => onRuntimeAction(runtime.stage as "provider-login" | "assistant");
  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-brand" aria-label="Job Hunter Team"><span className="onboarding-brand__mark" aria-hidden="true">J</span><span>Job Hunter Team</span></div>
        <span className="onboarding-session">Setup protetto</span>
      </header>
      <div className="onboarding-layout">
        <aside className="onboarding-progress">
          <p className="onboarding-eyebrow">Avvio automatico</p><h1>La squadra prende vita.</h1>
          <p className="onboarding-progress__intro">Prepariamo l’ambiente scelto, colleghiamo il tuo abbonamento e avviamo gli agenti.</p>
          <p className="onboarding-progress__privacy">Nessuna chiave API richiesta</p>
        </aside>
        <section className={`onboarding-runtime-card${failed ? " onboarding-runtime-card--failed" : ""}`}>
          <p className="onboarding-eyebrow">{failed ? "Intervento richiesto" : actionRequired ? "Tocca a te" : "Configurazione in corso"}</p>
          <h2>{failed ? `Configura di nuovo: ${activeLabel}` : actionRequired ? activeLabel : `Prepariamo: ${activeLabel}`}</h2>
          <OnboardingArtwork name={runtimeArtwork(runtime)} />
          <section className="onboarding-runtime-progress" aria-label="Avanzamento configurazione">
            <div className="onboarding-runtime-progress__heading">
              <div><strong>{currentActivity?.name ?? activeLabel}</strong><small>{currentActivity?.description ?? runtime.message}</small></div>
              <span>Trascorso <time>{elapsed}</time></span>
            </div>
            <progress aria-label="Passaggi completati" max={RUNTIME_STAGES.length} value={completedSteps} />
            <div className="onboarding-runtime-progress__meta"><span>Passaggio {Math.max(1, activeIndex + 1)} di {RUNTIME_STAGES.length}</span><span>{completedSteps} completati</span></div>
            {runtime.status === "working" && (
              <div
                className="onboarding-runtime-progress__indeterminate"
                role="progressbar"
                aria-label={`Avanzamento ${currentActivity?.name ?? activeLabel}`}
                aria-valuetext="Operazione in corso; percentuale non disponibile"
              ><i /></div>
            )}
          </section>
          <div className="onboarding-runtime-status" aria-live="polite" role={failed ? "alert" : "status"}>
            <span className="onboarding-runtime-status__pulse" aria-hidden="true">{failed ? "!" : actionRequired ? "→" : "••"}</span>
            <div><strong>{failed ? "Operazione interrotta in sicurezza" : actionRequired ? "È necessaria una tua azione" : "Non chiudere l’app"}</strong><small>{runtime.message}</small>{failed && runtime.code && <small>Codice diagnostico: {runtime.code}</small>}</div>
          </div>
          <ol className="onboarding-runtime-track">
            {RUNTIME_STAGES.map((stage, index) => (
              <li key={stage.value} className={index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : undefined}>
                <span>{index < activeIndex ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
                <em>{index < activeIndex ? "Pronto" : index === activeIndex ? failed ? "Da riprovare" : actionRequired ? "In attesa" : "In corso" : "In coda"}</em>
              </li>
            ))}
          </ol>
          <details className="onboarding-activity-details">
            <summary>Dettagli attività <span>{activity?.events.length ?? 0}</span></summary>
            {activity?.events.length ? (
              <ol>
                {activity.events.map((event) => (
                  <li key={event.id} className={event.status === "completed" ? "is-complete" : event.status === "failed" ? "is-failed" : "is-active"}>
                    <time>{formatElapsed(event.elapsedMs)}</time>
                    <div><strong>{event.name}</strong><small>{event.description}</small></div>
                    <span>{event.status === "completed" ? "Completato" : event.status === "failed" ? "Errore" : "In corso"}</span>
                  </li>
                ))}
              </ol>
            ) : <p>In attesa del primo aggiornamento verificato.</p>}
          </details>
          {runtime.stage === "provider-login" && (
            <ProviderLoginConsole providerLogin={providerLogin} onProviderInput={onProviderInput} onProviderClose={onProviderClose} />
          )}
          {runtime.stage === "ssh-host-key" && sshHostKey && (
            <section className="onboarding-provider-console" aria-label="Verifica identità server">
              <div className="onboarding-provider-console__heading"><div><strong>Controlla il fingerprint SSH</strong><small>Confrontalo con quello mostrato dal tuo provider VPS. Non contiene indirizzo o chiave privata.</small></div></div>
              <dl className="onboarding-review">
                <div><dt>Algoritmo</dt><dd>{sshHostKey.algorithm}</dd></div>
                <div><dt>Fingerprint</dt><dd>{sshHostKey.fingerprint}</dd></div>
              </dl>
            </section>
          )}
          {actionFailed && <p className="onboarding-error" role="alert">L’azione non è partita. Nessuna configurazione è stata persa: riprova.</p>}
          {failed && runtime.retryable === false && <p className="onboarding-error">Correggi i dati indicati prima di riprendere la configurazione.</p>}
          <div className="onboarding-runtime-actions">
            <button className="onboarding-secondary" type="button" onClick={() => invoke(onRestart)} disabled={pending}>
              Riparti da capo
            </button>
            {((failed && runtime.retryable !== false) || actionRequired) && (
              <>
              {runtime.stage === "ssh-host-key" && !failed && <button className="onboarding-secondary" type="button" onClick={onCancelHostKey} disabled={pending}>Annulla</button>}
              <button className="onboarding-primary" type="button" onClick={() => invoke(action)} disabled={pending}>
                {pending ? "Attendi…" : failed ? "Riprova questo passaggio" : actionLabel}<span aria-hidden="true">→</span>
              </button>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export function OnboardingFlow({ account, platform, runtime, activity, onSubmit, onRetry, onRestart, onRuntimeAction, providerLogin, sshHostKey, onConfirmHostKey, onCancelHostKey, onProviderInput, onProviderClose }: OnboardingFlowProps) {
  const localRuntimeSupported = platform === "macos" || platform === "linux";
  const [step, setStep] = useState(0);
  const [host, setHost] = useState<ExecutionHost>(() => localRuntimeSupported ? { kind: "local" } : emptyVpsHost());
  const [provider, setProvider] = useState<SubscriptionProvider | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!localRuntimeSupported) {
      setHost((current) => current.kind === "vps" ? current : emptyVpsHost());
    }
  }, [localRuntimeSupported]);

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  if (runtime.status !== "collecting") return <RuntimeView runtime={runtime} activity={activity} onRetry={onRetry} onRestart={onRestart} onRuntimeAction={onRuntimeAction} providerLogin={providerLogin} sshHostKey={sshHostKey} onConfirmHostKey={onConfirmHostKey} onCancelHostKey={onCancelHostKey} onProviderInput={onProviderInput} onProviderClose={onProviderClose} />;

  const hostIsValid = (localRuntimeSupported && host.kind === "local") ||
    (host.kind === "vps" && Boolean(host.address.trim() && host.user.trim() && host.port > 0 && host.port <= 65535 && host.keyPath.trim()));

  function next(event: FormEvent) {
    event.preventDefault(); setSubmitError(false); setStep((current) => Math.min(current + 1, COLLECTION_STEPS.length - 1));
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!hostIsValid || !provider || submitting) return;
    setSubmitting(true); setSubmitError(false);
    try {
      await onSubmit({
        host: host.kind === "vps" ? { ...host, address: host.address.trim(), user: host.user.trim(), keyPath: host.keyPath.trim() } : host,
        provider,
      });
    } catch { setSubmitError(true); } finally { setSubmitting(false); }
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-brand" aria-label="Job Hunter Team"><span className="onboarding-brand__mark" aria-hidden="true">J</span><span>Job Hunter Team</span></div>
        <span className="onboarding-session">
          {account.identity === "local" ? "Profilo locale attivo" : "Account Google collegato"}
        </span>
      </header>
      <div className="onboarding-layout">
        <aside className="onboarding-progress" aria-label="Avanzamento configurazione">
          <p className="onboarding-eyebrow">Prima configurazione</p><h1>Prepariamo la squadra.</h1>
          <p className="onboarding-progress__intro">Configura ambiente e provider. L’Assistente conoscerà poi obiettivi e preferenze conversando con te.</p>
          <ol>{COLLECTION_STEPS.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : undefined} aria-current={index === step ? "step" : undefined}><span>{index < step ? "✓" : index + 1}</span><div><small>Passaggio {index + 1}</small><strong>{label}</strong></div></li>)}</ol>
          <p className="onboarding-progress__privacy">Nessuna chiave API richiesta</p>
        </aside>

        <section className="onboarding-card">
          <div className="onboarding-card__step">{String(step + 1).padStart(2, "0")} / {String(COLLECTION_STEPS.length).padStart(2, "0")}</div>
          {step === 0 && <form onSubmit={next} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <div className="onboarding-account-mark" aria-hidden="true">{(account.displayName || "J").trim().charAt(0).toUpperCase() || "J"}</div>
            <p className="onboarding-eyebrow">{account.identity === "local" ? "Profilo locale pronto" : "Accesso riuscito"}</p><h2 ref={headingRef} tabIndex={-1}>Ciao{account.displayName ? `, ${account.displayName}` : ""}.</h2>
            <p className="onboarding-lede">{account.identity === "local" ? "Il nome resta su questo dispositivo. Configuriamo ambiente e provider; poi avvieremo la squadra automaticamente." : "Il tuo account è collegato. Configuriamo ambiente e provider; poi avvieremo la squadra automaticamente."}</p>
            <div className="onboarding-callout"><span aria-hidden="true">01</span><p><strong>Usa l’abbonamento che hai già.</strong> Claude, Codex o Kimi: nessuna chiave API da copiare.</p></div>
            <button className="onboarding-primary" type="submit">Inizia la configurazione <span aria-hidden="true">→</span></button>
          </form>}

          {step === 1 && <form onSubmit={next} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <p className="onboarding-eyebrow">Dove lavorerà il team</p><h2 ref={headingRef} tabIndex={-1}>Scegli l’ambiente.</h2>
            {localRuntimeSupported
              ? <p className="onboarding-lede">Puoi eseguire tutto su questo computer oppure collegare una VPS già disponibile.</p>
              : <p className="onboarding-lede">{platform === "windows" ? "Su Windows 0.4 il team deve essere eseguito su una VPS Linux. L’esecuzione locale sarà disponibile in una versione successiva." : "Su questa piattaforma il team deve essere eseguito su una VPS Linux. L’esecuzione locale non è ancora disponibile."}</p>}
            <div className="onboarding-choice-grid" role="radiogroup" aria-label="Ambiente di esecuzione">
              {localRuntimeSupported && <button data-radio-value="local" tabIndex={host.kind === "local" ? 0 : -1} className={`onboarding-choice${host.kind === "local" ? " is-selected" : ""}`} type="button" role="radio" aria-checked={host.kind === "local"} onKeyDown={(event) => moveRadio(event, ["local", "vps"] as const, host.kind, (kind) => setHost(kind === "local" ? { kind } : emptyVpsHost()))} onClick={() => setHost({ kind: "local" })}><span className="onboarding-choice__icon">PC</span><strong>Questo computer</strong><small>Podman e container locali, dati sotto il tuo controllo.</small><span className="onboarding-choice__check">✓</span></button>}
              <button data-radio-value="vps" tabIndex={host.kind === "vps" || !localRuntimeSupported ? 0 : -1} className={`onboarding-choice${host.kind === "vps" ? " is-selected" : ""}`} type="button" role="radio" aria-checked={host.kind === "vps"} onKeyDown={(event) => moveRadio(event, localRuntimeSupported ? ["local", "vps"] as const : ["vps"] as const, host.kind, (kind) => setHost(kind === "local" ? { kind } : emptyVpsHost()))} onClick={() => setHost(emptyVpsHost())}><span className="onboarding-choice__icon">VPS</span><strong>Server VPS</strong><small>Team sempre acceso su una macchina remota.</small><span className="onboarding-choice__check">✓</span></button>
            </div>
            {host.kind === "vps" && <div className="onboarding-fields onboarding-vps-fields">
              <label className="onboarding-field onboarding-field--full"><span>Indirizzo VPS</span><input value={host.address} onChange={(event) => setHost({ ...host, address: event.target.value })} placeholder="Hostname o indirizzo IP" required /></label>
              <label className="onboarding-field"><span>Utente SSH</span><input value={host.user} onChange={(event) => setHost({ ...host, user: event.target.value })} required /></label>
              <label className="onboarding-field"><span>Porta SSH</span><input type="number" min="1" max="65535" value={host.port} onChange={(event) => setHost({ ...host, port: Number(event.target.value) })} required /></label>
              <div className="onboarding-field onboarding-field--full"><span>Chiave SSH</span><SshKeyPicker value={host.keyPath} onChange={(keyPath) => setHost({ ...host, keyPath })} disabled={submitting} /></div>
            </div>}
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(0)}>Indietro</button><button className="onboarding-primary" type="submit" disabled={!hostIsValid}>Continua <span aria-hidden="true">→</span></button></div>
          </form>}

          {step === 2 && <form onSubmit={next} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <p className="onboarding-eyebrow">Il tuo abbonamento AI</p><h2 ref={headingRef} tabIndex={-1}>Scegli il provider.</h2><p className="onboarding-lede">Collegheremo il piano che usi già tramite il login ufficiale del provider.</p>
            <div className="onboarding-choice-grid onboarding-choice-grid--providers" role="radiogroup" aria-label="Provider in abbonamento">
              {PROVIDERS.map((item, index) => <button key={item.value} data-radio-value={item.value} tabIndex={provider === item.value || (provider === null && index === 0) ? 0 : -1} className={`onboarding-choice${provider === item.value ? " is-selected" : ""}`} type="button" role="radio" aria-checked={provider === item.value} onKeyDown={(event) => moveRadio(event, PROVIDERS.map(({ value }) => value), provider, setProvider)} onClick={() => setProvider(item.value)}><span className="onboarding-choice__icon">{item.mark}</span><strong>{item.label}</strong><small>{item.vendor}</small><span className="onboarding-choice__check">✓</span></button>)}
            </div>
            <p className="onboarding-subscription-note"><strong>Accesso in abbonamento.</strong> Non ti chiederemo API key: il login avverrà nel passaggio protetto successivo.</p>
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(1)}>Indietro</button><button className="onboarding-primary" type="submit" disabled={!provider}>Rivedi il setup <span aria-hidden="true">→</span></button></div>
          </form>}

          {step === 3 && provider && <form onSubmit={finish} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <p className="onboarding-eyebrow">Ultimo controllo</p><h2 ref={headingRef} tabIndex={-1}>Tutto pronto per partire.</h2><p className="onboarding-lede">Dopo la conferma prepareremo runtime, container, login e agenti. Poi apriremo la chat con l’Assistente.</p>
            <dl className="onboarding-review">
              <div><dt>Ambiente</dt><dd>{hostName(host)}</dd></div><div><dt>Provider</dt><dd>{providerName(provider)}<small>Accesso tramite abbonamento</small></dd></div>
            </dl>
            {submitError && <p className="onboarding-error" role="alert">Il setup non è partito. Nessun dato è andato perso: controlla la connessione e riprova.</p>}
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => { setSubmitError(false); setStep(2); }} disabled={submitting}>Modifica</button><button className="onboarding-primary" type="submit" disabled={submitting}>{submitting ? "Avvio del setup…" : "Prepara la squadra"}<span aria-hidden="true">→</span></button></div>
          </form>}
        </section>
      </div>
    </main>
  );
}
