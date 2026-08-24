import { FormEvent, useState } from "react";

type Screen = "welcome" | "setup";

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
        <span className="status-pill"><i /> Anteprima locale</span>
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">La tua squadra, sul tuo computer</p>
          <h1>
            La ricerca cambia<br />
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
            <span>Sc</span><span>An</span><span>Cr</span><span>Me</span>
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
}

function SetupPage({ onBack }: SetupPageProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const confirmSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setApiKey("");
    setConfirmed(true);
  };

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
              <div><strong>Questo PC</strong><small>Container isolati con Podman</small></div>
              <span className="selected-tag">Selezionato</span>
            </li>
            <li>
              <span className="summary-number">2</span>
              <div><strong>Agenti API headless</strong><small>Consumo sulla tua chiave OpenAI</small></div>
              <span className="selected-tag">Selezionato</span>
            </li>
          </ol>
        </div>

        <form className="setup-card" onSubmit={confirmSetup} autoComplete="off">
          <div className="setup-card__heading">
            <div className="provider-icon" aria-hidden="true">AI</div>
            <div>
              <span className="card-kicker">Accesso al provider</span>
              <h2>Chiave API OpenAI</h2>
            </div>
          </div>

          <p className="card-description">
            Verrà usata dagli agenti Node.js headless nel container locale. I
            costi di utilizzo restano sul tuo account provider.
          </p>

          <label htmlFor="openai-api-key">API key</label>
          <div className="secret-input">
            <input
              id="openai-api-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setConfirmed(false);
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
            In questo prototipo resta solo in memoria e viene cancellata alla
            conferma. Il salvataggio nel portachiavi di sistema arriverà nel
            prossimo slice.
          </p>

          {confirmed && (
            <div className="confirmation" role="status">
              <span aria-hidden="true">✓</span>
              Percorso confermato. Podman e provisioning saranno collegati nel
              prossimo step di implementazione.
            </div>
          )}

          <button className="primary-button primary-button--wide" type="submit" disabled={!apiKey.trim()}>
            Conferma questo setup <ArrowIcon />
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

export default function App() {
  const [screen, setScreen] = useState<Screen>("welcome");

  return screen === "welcome" ? (
    <WelcomePage onStart={() => setScreen("setup")} />
  ) : (
    <SetupPage onBack={() => setScreen("welcome")} />
  );
}
