import { FormEvent, useCallback, useEffect, useState } from "react";
import { ResultExplorer, TeamLiveDashboard } from "./components/team-dashboard";
import { checkPodman, type PodmanStatus } from "./lib/podman";
import {
  isTeamAgentActivity,
  startApiTeam,
  type TeamAgentActivity,
  type TeamProgress,
  type TeamStartResult,
} from "./lib/team";

type Screen = "welcome" | "setup" | "team";

function BrandMark() {
  return (
    <div className="brand" aria-label="Job Hunter Team">
      <img src="/jht-mark.svg" alt="" className="brand__mark" />
      <span className="brand__name">Job Hunter Team</span>
      <span className="brand__edition">desktop</span>
    </div>
  );
}

function ArrowIcon() {
  return <span aria-hidden="true">→</span>;
}

function WelcomePage({ onStart }: { onStart: () => void }) {
  return (
    <main className="page page--welcome">
      <header className="topbar">
        <BrandMark />
        <span className="status-pill">
          <i /> Anteprima locale
        </span>
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">La tua squadra, sul tuo computer</p>
          <h1>
            La ricerca cambia
            <br />
            quando <em>non sei più solo.</em>
          </h1>
          <p className="lede">
            Configura una squadra di agenti specializzati che cerca opportunità,
            valuta posizioni e prepara candidature insieme a te.
          </p>
          <button className="primary-button" type="button" onClick={onStart}>
            Inizia la configurazione <ArrowIcon />
          </button>
          <div className="trust-row" aria-label="Caratteristiche del setup">
            <span>Podman locale</span>
            <span>Dati sotto il tuo controllo</span>
            <span>API a consumo</span>
          </div>
        </div>

        <aside className="captain-card" aria-label="Messaggio del Capitano">
          <div className="captain-card__glow" />
          <div className="captain-card__header">
            <img src="/capitano.png" alt="Capitano" />
            <div>
              <strong>Capitano</strong>
              <span>Coordinatore della squadra</span>
            </div>
            <i className="online-dot" title="Online" />
          </div>
          <blockquote>
            “Partiamo dalle fondamenta: dove lavoriamo e come accediamo ai
            modelli. Al resto penseremo un passo alla volta.”
          </blockquote>
          <div className="mini-team" aria-hidden="true">
            <span>Sc</span>
            <span>An</span>
            <span>Cr</span>
            <span>Me</span>
            <b>+5 agenti</b>
          </div>
        </aside>
      </section>

      <footer className="page-footer">
        <span>JHT Desktop · primo avvio</span>
        <span>01 / 02</span>
      </footer>
    </main>
  );
}

interface SetupPageProps {
  onBack: () => void;
  onStarted: (result: TeamStartResult) => void;
}

type PodmanCheckState =
  | { phase: "checking" }
  | { phase: "desktop-only" }
  | { phase: "complete"; result: PodmanStatus }
  | { phase: "error" };

function PodmanCheck({
  state,
  onRetry,
}: {
  state: PodmanCheckState;
  onRetry: () => void;
}) {
  const checking = state.phase === "checking";
  let title = "Controllo di Podman…";
  let detail = "Verifico CLI e motore container sul computer.";
  let tone = "checking";

  if (state.phase === "desktop-only") {
    title = "Verifica disponibile nell’app desktop";
    detail = "Il browser di sviluppo non può interrogare Podman.";
    tone = "neutral";
  } else if (state.phase === "error") {
    title = "Verifica Podman non riuscita";
    detail = "Riprova; nessuna configurazione è stata modificata.";
    tone = "warning";
  } else if (state.phase === "complete" && state.result.ready) {
    title = "Podman è pronto";
    detail =
      state.result.version ??
      "CLI e motore container rispondono correttamente.";
    tone = "ready";
  } else if (
    state.phase === "complete" &&
    state.result.installed &&
    state.result.issue?.startsWith("engine_")
  ) {
    title = "Podman è installato, ma il motore non risponde";
    detail = "Avvia Podman (o la Podman machine) e ripeti la verifica.";
    tone = "warning";
  } else if (state.phase === "complete" && state.result.issue === "not_found") {
    title = "Podman non è stato trovato";
    detail = "Installa Podman Desktop, poi ripeti la verifica.";
    tone = "warning";
  } else if (state.phase === "complete") {
    title = "Podman non ha completato la verifica";
    detail = "Controlla l’installazione e riprova.";
    tone = "warning";
  }

  return (
    <div className={`podman-check podman-check--${tone}`} aria-live="polite">
      <span className="podman-check__indicator" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <button type="button" onClick={onRetry} disabled={checking}>
        {checking ? "Attendi" : "Riprova"}
      </button>
    </div>
  );
}

type TeamLaunchState =
  | { phase: "idle" }
  | { phase: "running"; progress: TeamProgress }
  | { phase: "error"; message: string };

const TEAM_ERROR_MESSAGES: Record<string, string> = {
  desktop_only: "Avvia questa operazione dall’app desktop Tauri.",
  invalid_api_key: "La chiave non ha un formato valido. Controllala e riprova.",
  podman_not_found: "Podman non è installato su questo computer.",
  podman_machine_failed: "Non sono riuscito a inizializzare la Podman machine.",
  podman_engine_unavailable: "Il motore Podman non è raggiungibile.",
  credential_injection_failed:
    "Non sono riuscito a creare la credenziale temporanea.",
  image_build_failed: "La preparazione dell’immagine agenti non è riuscita.",
  image_build_timeout:
    "La preparazione dell’immagine ha superato il tempo massimo.",
  team_already_running: "Un’esecuzione del team è già in corso.",
  team_timeout: "Il team ha superato il tempo massimo previsto.",
  team_run_failed:
    "Il provider ha rifiutato la richiesta oppure il team si è fermato in sicurezza.",
  team_result_invalid: "Il team ha terminato con un risultato non leggibile.",
  storage_failed: "Non posso creare la cartella locale degli artefatti.",
  runtime_missing:
    "Le risorse degli agenti non sono presenti nel bundle desktop.",
  runtime_failed: "Il runtime degli agenti si è interrotto in modo inatteso.",
};

function teamErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    return TEAM_ERROR_MESSAGES[code] ?? "Avvio del team non riuscito.";
  }
  return "Avvio del team non riuscito.";
}

function SetupPage({ onBack, onStarted }: SetupPageProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [podmanState, setPodmanState] = useState<PodmanCheckState>({
    phase: "checking",
  });
  const [launchState, setLaunchState] = useState<TeamLaunchState>({
    phase: "idle",
  });
  const [activity, setActivity] = useState<TeamAgentActivity[]>([]);

  const runPodmanCheck = useCallback(async () => {
    setPodmanState({ phase: "checking" });
    try {
      const result = await checkPodman();
      setPodmanState(
        result ? { phase: "complete", result } : { phase: "desktop-only" },
      );
    } catch {
      setPodmanState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    void runPodmanCheck();
  }, [runPodmanCheck]);

  const confirmSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    const submittedKey = apiKey.trim();
    setActivity([]);
    setApiKey("");
    setShowKey(false);
    setLaunchState({
      phase: "running",
      progress: {
        stage: "podman",
        message: "Avvio e verifica del motore Podman",
      },
    });
    try {
      const result = await startApiTeam(submittedKey, (progress) => {
        setLaunchState({ phase: "running", progress });
        if (isTeamAgentActivity(progress)) {
          setActivity((events) => [...events, progress].slice(-80));
        }
      });
      onStarted(result);
    } catch (error) {
      setLaunchState({ phase: "error", message: teamErrorMessage(error) });
    }
  };

  if (launchState.phase === "running") {
    return (
      <main className="page page--live-team">
        <header className="topbar">
          <BrandMark />
          <span className="status-pill">
            <i /> Team in esecuzione
          </span>
        </header>
        <TeamLiveDashboard
          progress={launchState.progress}
          activity={activity}
        />
        <footer className="page-footer">
          <span>PC locale · Podman · OpenAI API</span>
          <span>Non chiudere l’app</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="page page--setup">
      <header className="topbar">
        <BrandMark />
        <span className="step-label">Setup iniziale · 02 / 02</span>
      </header>

      <section className="setup-layout">
        <div className="setup-intro">
          <button className="back-button" type="button" onClick={onBack}>
            <span aria-hidden="true">←</span> Indietro
          </button>
          <p className="eyebrow">Configurazione essenziale</p>
          <h1>Prepariamo il tuo ambiente.</h1>
          <p>
            Per questo primo slice usiamo un solo percorso, già deciso e facile
            da verificare: container locali e agenti API headless.
          </p>

          <ol className="setup-summary">
            <li>
              <span className="summary-number">1</span>
              <div>
                <strong>Questo PC</strong>
                <small>Container isolati con Podman</small>
              </div>
              <span className="selected-tag">Selezionato</span>
            </li>
            <li>
              <span className="summary-number">2</span>
              <div>
                <strong>Agenti API headless</strong>
                <small>Consumo sulla tua chiave OpenAI</small>
              </div>
              <span className="selected-tag">Selezionato</span>
            </li>
          </ol>
        </div>

        <form
          className="setup-card"
          onSubmit={(event) => void confirmSetup(event)}
          autoComplete="off"
        >
          <div className="setup-card__heading">
            <div className="provider-icon" aria-hidden="true">
              AI
            </div>
            <div>
              <span className="card-kicker">Accesso al provider</span>
              <h2>Chiave API OpenAI</h2>
            </div>
          </div>

          <p className="card-description">
            Avvierà gli agenti Node.js headless nel container locale. Il primo
            test usa solo profilo e posizioni sintetiche, con tetto massimo di
            $0,10.
          </p>

          <PodmanCheck
            state={podmanState}
            onRetry={() => void runPodmanCheck()}
          />

          <label htmlFor="openai-api-key">API key</label>
          <div className="secret-input">
            <input
              id="openai-api-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setLaunchState({ phase: "idle" });
              }}
              placeholder="sk-…"
              autoComplete="new-password"
              spellCheck={false}
              aria-describedby="key-safety-note"
            />
            <button type="button" onClick={() => setShowKey((value) => !value)}>
              {showKey ? "Nascondi" : "Mostra"}
            </button>
          </div>

          <p id="key-safety-note" className="safety-note">
            <span aria-hidden="true">◇</span>
            La chiave non viene salvata: passa a Podman tramite un secret
            temporaneo e viene rimossa subito dopo il run.
          </p>

          {launchState.phase === "error" && (
            <div className="launch-error" role="alert">
              <span aria-hidden="true">!</span>
              {launchState.message}
            </div>
          )}

          <button
            className="primary-button primary-button--wide"
            type="submit"
            disabled={!apiKey.trim()}
          >
            Avvia il team ora <ArrowIcon />
          </button>
        </form>
      </section>

      <footer className="page-footer">
        <span>PC locale · Podman · OpenAI API</span>
        <span>02 / 02</span>
      </footer>
    </main>
  );
}

function TeamPage({
  result,
  onRestart,
}: {
  result: TeamStartResult;
  onRestart: () => void;
}) {
  return (
    <main className="page page--team">
      <header className="topbar">
        <BrandMark />
        <span className="status-pill">
          <i /> Team operativo
        </span>
      </header>

      <section className="team-result">
        <div className="team-result__hero">
          <p className="eyebrow">Primo giro completato</p>
          <h1>
            La squadra
            <br />
            <em>ha iniziato.</em>
          </h1>
          <p>
            Il runtime API headless ha completato il test con dati sintetici.
            Database e artefatti sono rimasti sul tuo computer.
          </p>
          <div className="result-metrics">
            <div>
              <strong>{result.agentCount}</strong>
              <span>agenti coinvolti</span>
            </div>
            <div>
              <strong>{result.scored}</strong>
              <span>posizioni valutate</span>
            </div>
            <div>
              <strong>{result.reviewed}</strong>
              <span>CV revisionati</span>
            </div>
            <div>
              <strong>${result.spentUsd.toFixed(4)}</strong>
              <span>costo stimato</span>
            </div>
          </div>
          <button className="primary-button" type="button" onClick={onRestart}>
            Esegui un altro test <ArrowIcon />
          </button>
        </div>

        <ResultExplorer result={result} />
      </section>

      <footer className="page-footer">
        <span>PC locale · Podman · OpenAI API</span>
        <span>Team ready</span>
      </footer>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [teamResult, setTeamResult] = useState<TeamStartResult | null>(null);

  if (screen === "welcome")
    return <WelcomePage onStart={() => setScreen("setup")} />;
  if (screen === "team" && teamResult) {
    return (
      <TeamPage result={teamResult} onRestart={() => setScreen("setup")} />
    );
  }
  return (
    <SetupPage
      onBack={() => setScreen("welcome")}
      onStarted={(result) => {
        setTeamResult(result);
        setScreen("team");
      }}
    />
  );
}
