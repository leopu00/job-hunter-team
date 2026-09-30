import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  ExecutionHost,
  OnboardingFlowProps,
  OnboardingProfileDraft,
  OnboardingRuntimeStage,
  SubscriptionProvider,
  WorkMode,
} from "../lib/onboarding";
import "./onboarding.css";

const EMPTY_PROFILE: OnboardingProfileDraft = {
  fullName: "", targetRole: "", location: "", experienceYears: 0,
  skills: [], languages: [], workMode: "flexible", notes: "",
};
const COLLECTION_STEPS = ["Benvenuto", "Profilo", "Preferenze", "Ambiente", "Provider", "Conferma"] as const;
const WORK_MODES: Array<{ value: WorkMode; label: string }> = [
  { value: "flexible", label: "Flessibile" }, { value: "remote", label: "Da remoto" },
  { value: "hybrid", label: "Ibrido" }, { value: "onsite", label: "In sede" },
];
const PROVIDERS: Array<{ value: SubscriptionProvider; label: string; vendor: string; mark: string }> = [
  { value: "claude", label: "Claude Code", vendor: "Anthropic · Claude Pro/Max", mark: "CL" },
  { value: "codex", label: "Codex", vendor: "OpenAI · ChatGPT Plus/Pro", mark: "CX" },
  { value: "kimi", label: "Kimi", vendor: "Moonshot · piano Kimi", mark: "KM" },
];
const RUNTIME_STAGES: Array<{ value: OnboardingRuntimeStage; label: string; detail: string }> = [
  { value: "profile", label: "Profilo", detail: "Preferenze validate" },
  { value: "host", label: "Ambiente", detail: "Computer o VPS" },
  { value: "provider", label: "Provider", detail: "Abbonamento selezionato" },
  { value: "runtime", label: "Runtime", detail: "Installazione e preparazione" },
  { value: "provider-login", label: "Accesso provider", detail: "Login con abbonamento" },
  { value: "team-start", label: "Squadra", detail: "Container e agenti" },
  { value: "assistant", label: "Assistente", detail: "Primo contatto" },
];

function splitList(value: string) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

function normalizedProfile(profile: OnboardingProfileDraft, skills: string, languages: string): OnboardingProfileDraft {
  return {
    ...profile,
    fullName: profile.fullName.trim(), targetRole: profile.targetRole.trim(), location: profile.location.trim(),
    experienceYears: Math.max(0, Math.floor(profile.experienceYears || 0)),
    skills: splitList(skills), languages: splitList(languages), notes: profile.notes.trim(),
  };
}

function firstStep(stage: "profile" | "host" | "provider") {
  return stage === "host" ? 3 : stage === "provider" ? 4 : 0;
}

function providerName(provider: SubscriptionProvider) {
  return PROVIDERS.find((item) => item.value === provider)?.label ?? provider;
}

function hostName(host: ExecutionHost) {
  return host.kind === "local" ? "Questo computer" : `VPS · ${host.user}@${host.address}:${host.port}`;
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

function RuntimeView({ runtime, onRetry, onRuntimeAction, providerLogin, onProviderInput, onProviderClose }: Pick<OnboardingFlowProps, "runtime" | "onRetry" | "onRuntimeAction" | "providerLogin" | "onProviderInput" | "onProviderClose">) {
  const [pending, setPending] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    setPending(false);
    setActionFailed(false);
  }, [runtime.status, "stage" in runtime ? runtime.stage : "ready"]);

  if (runtime.status === "ready") {
    return (
      <main className="onboarding-shell onboarding-shell--complete">
        <section className="onboarding-complete" aria-live="polite">
          <span className="onboarding-complete__mark" aria-hidden="true">✓</span>
          <p className="onboarding-eyebrow">Configurazione completata</p>
          <h1>La squadra è pronta.</h1>
          <p>Profilo, provider, container e agenti sono stati verificati. Stiamo aprendo la dashboard.</p>
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

  async function invoke(action: () => Promise<void>) {
    if (pending) return;
    setPending(true); setActionFailed(false);
    try { await action(); } catch { setActionFailed(true); } finally { setPending(false); }
  }

  const actionLabel = runtime.stage === "assistant" ? "Apri l’Assistente" : "Accedi al provider";
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
          <div className="onboarding-runtime-status" aria-live="polite" role={failed ? "alert" : "status"}>
            <span className="onboarding-runtime-status__pulse" aria-hidden="true">{failed ? "!" : actionRequired ? "→" : "••"}</span>
            <div><strong>{failed ? "Operazione interrotta in sicurezza" : actionRequired ? "È necessaria una tua azione" : "Non chiudere l’app"}</strong><small>{runtime.message}</small></div>
          </div>
          <ol className="onboarding-runtime-track">
            {RUNTIME_STAGES.map((stage, index) => (
              <li key={stage.value} className={index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : undefined}>
                <span>{index < activeIndex ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
                <em>{index < activeIndex ? "Pronto" : index === activeIndex ? failed ? "Da riprovare" : actionRequired ? "In attesa" : "In corso" : "In coda"}</em>
              </li>
            ))}
          </ol>
          {runtime.stage === "provider-login" && (
            <ProviderLoginConsole providerLogin={providerLogin} onProviderInput={onProviderInput} onProviderClose={onProviderClose} />
          )}
          {actionFailed && <p className="onboarding-error" role="alert">L’azione non è partita. Nessuna configurazione è stata persa: riprova.</p>}
          {(failed || actionRequired) && (
            <div className="onboarding-runtime-actions">
              <button className="onboarding-primary" type="button" onClick={() => invoke(failed ? onRetry : () => onRuntimeAction(runtime.stage as "provider-login" | "assistant"))} disabled={pending}>
                {pending ? "Attendi…" : failed ? "Riprova questo passaggio" : actionLabel}<span aria-hidden="true">→</span>
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export function OnboardingFlow({ account, initialDraft, runtime, onSubmit, onRetry, onRuntimeAction, providerLogin, onProviderInput, onProviderClose }: OnboardingFlowProps) {
  const startingProfile = useMemo<OnboardingProfileDraft>(() => ({
    ...EMPTY_PROFILE, ...initialDraft, fullName: initialDraft?.fullName || account.displayName || "",
    skills: initialDraft?.skills ?? [], languages: initialDraft?.languages ?? [],
  }), [account.displayName, initialDraft]);
  const [step, setStep] = useState(() => runtime.status === "collecting" ? firstStep(runtime.stage) : 0);
  const [profile, setProfile] = useState(startingProfile);
  const [skillsText, setSkillsText] = useState(startingProfile.skills.join(", "));
  const [languagesText, setLanguagesText] = useState(startingProfile.languages.join(", "));
  const [host, setHost] = useState<ExecutionHost>({ kind: "local" });
  const [provider, setProvider] = useState<SubscriptionProvider | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  if (runtime.status !== "collecting") return <RuntimeView runtime={runtime} onRetry={onRetry} onRuntimeAction={onRuntimeAction} providerLogin={providerLogin} onProviderInput={onProviderInput} onProviderClose={onProviderClose} />;

  const cleanProfile = normalizedProfile(profile, skillsText, languagesText);
  const profileIsValid = Boolean(cleanProfile.fullName && cleanProfile.targetRole && cleanProfile.location);
  const preferencesAreValid = cleanProfile.skills.length >= 2 && cleanProfile.languages.length >= 1;
  const hostIsValid = host.kind === "local" || Boolean(host.address.trim() && host.user.trim() && host.port > 0 && host.port <= 65535 && host.keyPath.trim());

  function update<K extends keyof OnboardingProfileDraft>(key: K, value: OnboardingProfileDraft[K]) {
    setSubmitError(false); setProfile((current) => ({ ...current, [key]: value }));
  }
  function next(event: FormEvent) {
    event.preventDefault(); setSubmitError(false); setStep((current) => Math.min(current + 1, COLLECTION_STEPS.length - 1));
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!profileIsValid || !preferencesAreValid || !hostIsValid || !provider || submitting) return;
    setSubmitting(true); setSubmitError(false);
    try {
      await onSubmit({
        profile: cleanProfile,
        host: host.kind === "vps" ? { ...host, address: host.address.trim(), user: host.user.trim(), keyPath: host.keyPath.trim() } : host,
        provider,
      });
    } catch { setSubmitError(true); } finally { setSubmitting(false); }
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-brand" aria-label="Job Hunter Team"><span className="onboarding-brand__mark" aria-hidden="true">J</span><span>Job Hunter Team</span></div>
        <span className="onboarding-session">Account Google collegato</span>
      </header>
      <div className="onboarding-layout">
        <aside className="onboarding-progress" aria-label="Avanzamento configurazione">
          <p className="onboarding-eyebrow">Prima configurazione</p><h1>Prepariamo la tua ricerca.</h1>
          <p className="onboarding-progress__intro">Dal profilo al team operativo, senza chiavi API e usando il tuo abbonamento.</p>
          <ol>{COLLECTION_STEPS.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : undefined} aria-current={index === step ? "step" : undefined}><span>{index < step ? "✓" : index + 1}</span><div><small>Passaggio {index + 1}</small><strong>{label}</strong></div></li>)}</ol>
          <p className="onboarding-progress__privacy">Nessuna chiave API richiesta</p>
        </aside>

        <section className="onboarding-card">
          <div className="onboarding-card__step">{String(step + 1).padStart(2, "0")} / {String(COLLECTION_STEPS.length).padStart(2, "0")}</div>
          {step === 0 && <form onSubmit={next} className="onboarding-panel">
            <div className="onboarding-account-mark" aria-hidden="true">{(account.displayName || "J").trim().charAt(0).toUpperCase() || "J"}</div>
            <p className="onboarding-eyebrow">Accesso riuscito</p><h2>Ciao{account.displayName ? `, ${account.displayName}` : ""}.</h2>
            <p className="onboarding-lede">Il tuo account è collegato. Configuriamo profilo, ambiente e provider; poi avvieremo la squadra automaticamente.</p>
            <div className="onboarding-callout"><span aria-hidden="true">01</span><p><strong>Usa l’abbonamento che hai già.</strong> Claude, Codex o Kimi: nessuna chiave API da copiare.</p></div>
            <button className="onboarding-primary" type="submit">Inizia la configurazione <span aria-hidden="true">→</span></button>
          </form>}

          {step === 1 && <form onSubmit={next} className="onboarding-panel">
            <p className="onboarding-eyebrow">Il tuo obiettivo</p><h2>Partiamo da te.</h2><p className="onboarding-lede">Questi dati definiscono quali ruoli e mercati devono avere la priorità.</p>
            <div className="onboarding-fields">
              <label className="onboarding-field onboarding-field--full"><span>Nome completo</span><input autoFocus autoComplete="name" value={profile.fullName} onChange={(event) => update("fullName", event.target.value)} placeholder="Come vuoi essere chiamato" required /></label>
              <label className="onboarding-field onboarding-field--full"><span>Ruolo obiettivo</span><input value={profile.targetRole} onChange={(event) => update("targetRole", event.target.value)} placeholder="Es. Product Designer" required /></label>
              <label className="onboarding-field"><span>Località</span><input autoComplete="address-level2" value={profile.location} onChange={(event) => update("location", event.target.value)} placeholder="Es. Milano, Italia" required /></label>
              <label className="onboarding-field"><span>Anni di esperienza</span><input type="number" inputMode="numeric" min="0" max="60" value={profile.experienceYears} onChange={(event) => update("experienceYears", Number(event.target.value))} required /></label>
            </div>
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(0)}>Indietro</button><button className="onboarding-primary" type="submit" disabled={!profileIsValid}>Continua <span aria-hidden="true">→</span></button></div>
          </form>}

          {step === 2 && <form onSubmit={next} className="onboarding-panel">
            <p className="onboarding-eyebrow">Come lavori</p><h2>Mettiamo a fuoco il profilo.</h2><p className="onboarding-lede">Separa competenze e lingue con una virgola. Ne servono almeno due e una.</p>
            <div className="onboarding-fields">
              <label className="onboarding-field onboarding-field--full"><span>Competenze principali</span><input autoFocus value={skillsText} onChange={(event) => setSkillsText(event.target.value)} placeholder="Es. React, TypeScript, Design system" aria-describedby="skills-help" required /><small id="skills-help">Almeno 2 competenze · {cleanProfile.skills.length} inserite</small></label>
              <label className="onboarding-field onboarding-field--full"><span>Lingue</span><input value={languagesText} onChange={(event) => setLanguagesText(event.target.value)} placeholder="Es. Italiano, Inglese" aria-describedby="languages-help" required /><small id="languages-help">Almeno 1 lingua · {cleanProfile.languages.length} inserite</small></label>
              <label className="onboarding-field onboarding-field--full"><span>Modalità di lavoro</span><select value={profile.workMode} onChange={(event) => update("workMode", event.target.value as WorkMode)}>{WORK_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
              <label className="onboarding-field onboarding-field--full"><span>Note per la squadra <em>facoltative</em></span><textarea rows={3} value={profile.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Settori, aziende o vincoli da tenere presenti" /></label>
            </div>
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(1)}>Indietro</button><button className="onboarding-primary" type="submit" disabled={!preferencesAreValid}>Continua <span aria-hidden="true">→</span></button></div>
          </form>}

          {step === 3 && <form onSubmit={next} className="onboarding-panel">
            <p className="onboarding-eyebrow">Dove lavorerà il team</p><h2>Scegli l’ambiente.</h2><p className="onboarding-lede">Puoi eseguire tutto su questo computer oppure collegare una VPS già disponibile.</p>
            <div className="onboarding-choice-grid" role="radiogroup" aria-label="Ambiente di esecuzione">
              <button className={`onboarding-choice${host.kind === "local" ? " is-selected" : ""}`} type="button" role="radio" aria-checked={host.kind === "local"} onClick={() => setHost({ kind: "local" })}><span className="onboarding-choice__icon">PC</span><strong>Questo computer</strong><small>Container locali, dati sotto il tuo controllo.</small><span className="onboarding-choice__check">✓</span></button>
              <button className={`onboarding-choice${host.kind === "vps" ? " is-selected" : ""}`} type="button" role="radio" aria-checked={host.kind === "vps"} onClick={() => setHost({ kind: "vps", address: "", user: "root", port: 22, keyPath: "" })}><span className="onboarding-choice__icon">VPS</span><strong>Server VPS</strong><small>Team sempre acceso su una macchina remota.</small><span className="onboarding-choice__check">✓</span></button>
            </div>
            {host.kind === "vps" && <div className="onboarding-fields onboarding-vps-fields">
              <label className="onboarding-field onboarding-field--full"><span>Indirizzo VPS</span><input autoFocus value={host.address} onChange={(event) => setHost({ ...host, address: event.target.value })} placeholder="Hostname o indirizzo IP" required /></label>
              <label className="onboarding-field"><span>Utente SSH</span><input value={host.user} onChange={(event) => setHost({ ...host, user: event.target.value })} required /></label>
              <label className="onboarding-field"><span>Porta SSH</span><input type="number" min="1" max="65535" value={host.port} onChange={(event) => setHost({ ...host, port: Number(event.target.value) })} required /></label>
              <label className="onboarding-field onboarding-field--full"><span>File chiave SSH</span><input value={host.keyPath} onChange={(event) => setHost({ ...host, keyPath: event.target.value })} placeholder="Percorso del file, mai il contenuto della chiave" required /><small>Indica il file locale. Il contenuto della chiave non viene mostrato né copiato.</small></label>
            </div>}
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(2)}>Indietro</button><button className="onboarding-primary" type="submit" disabled={!hostIsValid}>Continua <span aria-hidden="true">→</span></button></div>
          </form>}

          {step === 4 && <form onSubmit={next} className="onboarding-panel">
            <p className="onboarding-eyebrow">Il tuo abbonamento AI</p><h2>Scegli il provider.</h2><p className="onboarding-lede">Collegheremo il piano che usi già tramite il login ufficiale del provider.</p>
            <div className="onboarding-choice-grid onboarding-choice-grid--providers" role="radiogroup" aria-label="Provider in abbonamento">
              {PROVIDERS.map((item) => <button key={item.value} className={`onboarding-choice${provider === item.value ? " is-selected" : ""}`} type="button" role="radio" aria-checked={provider === item.value} onClick={() => setProvider(item.value)}><span className="onboarding-choice__icon">{item.mark}</span><strong>{item.label}</strong><small>{item.vendor}</small><span className="onboarding-choice__check">✓</span></button>)}
            </div>
            <p className="onboarding-subscription-note"><strong>Accesso in abbonamento.</strong> Non ti chiederemo API key: il login avverrà nel passaggio protetto successivo.</p>
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(3)}>Indietro</button><button className="onboarding-primary" type="submit" disabled={!provider}>Rivedi il setup <span aria-hidden="true">→</span></button></div>
          </form>}

          {step === 5 && provider && <form onSubmit={finish} className="onboarding-panel">
            <p className="onboarding-eyebrow">Ultimo controllo</p><h2>Tutto pronto per partire.</h2><p className="onboarding-lede">Dopo la conferma prepareremo runtime, login, container e agenti. La dashboard si aprirà solo a team verificato.</p>
            <dl className="onboarding-review">
              <div><dt>Profilo</dt><dd>{cleanProfile.fullName}<small>{cleanProfile.targetRole}</small></dd></div>
              <div><dt>Ricerca</dt><dd>{cleanProfile.location}<small>{cleanProfile.experienceYears} {cleanProfile.experienceYears === 1 ? "anno" : "anni"} di esperienza</small></dd></div>
              <div className="onboarding-review__wide"><dt>Competenze</dt><dd>{cleanProfile.skills.join(" · ")}<small>{cleanProfile.languages.join(" · ")}</small></dd></div>
              <div><dt>Ambiente</dt><dd>{hostName(host)}</dd></div><div><dt>Provider</dt><dd>{providerName(provider)}<small>Accesso tramite abbonamento</small></dd></div>
            </dl>
            {submitError && <p className="onboarding-error" role="alert">Il setup non è partito. Nessun dato è andato perso: controlla la connessione e riprova.</p>}
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => { setSubmitError(false); setStep(4); }} disabled={submitting}>Modifica</button><button className="onboarding-primary" type="submit" disabled={submitting}>{submitting ? "Avvio del setup…" : "Prepara la squadra"}<span aria-hidden="true">→</span></button></div>
          </form>}
        </section>
      </div>
    </main>
  );
}
