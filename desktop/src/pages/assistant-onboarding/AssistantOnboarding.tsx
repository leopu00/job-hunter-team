import { useEffect, useRef, useState } from "react";
import type {
  AssistantOnboardingPath,
  AssistantOnboardingProps,
  AssistantOnboardingState,
  AssistantOnboardingStep,
} from "./contract";
import { INITIAL_ASSISTANT_ONBOARDING_STATE } from "./contract";
import { VoiceInputControl } from "../../voice-input";
import "./assistant-onboarding.css";

type GuideStep = {
  eyebrow: string;
  title: string;
  message: string;
};

const PATH_LABELS: Record<AssistantOnboardingPath, string> = {
  tour: "Tour guidato",
  requirements: "Cosa serve",
  explore: "Esplora",
};

const GUIDES: Record<AssistantOnboardingPath, readonly GuideStep[]> = {
  tour: [
    {
      eyebrow: "Tappa 01 · orientamento",
      title: "Parti dalla Dashboard",
      message:
        "La Dashboard riunisce ciò che merita attenzione. Da lì puoi entrare nelle aree di lavoro senza perdere il filo.",
    },
    {
      eyebrow: "Tappa 02 · opportunità",
      title: "Leggi, confronta, decidi",
      message:
        "Posizioni raccoglie le opportunità, Map le mette nello spazio e Swipe aiuta a fare una prima scelta rapida.",
    },
    {
      eyebrow: "Tappa 03 · squadra",
      title: "Segui il lavoro del team",
      message:
        "Team e Agenti mostrano le persone e le attività. Messaggi è il punto in cui ritrovi le conversazioni disponibili.",
    },
    {
      eyebrow: "Tappa 04 · Assistente",
      title: "Continua con parole tue",
      message:
        "La guida finisce qui. Nella chat libera puoi fare una domanda concreta all’Assistente, senza scegliere da un elenco.",
    },
  ],
  requirements: [
    {
      eyebrow: "Tappa 01 · ambiente",
      title: "Una casa per il team",
      message:
        "Il team ha bisogno di una macchina configurata e raggiungibile. La relativa procedura di setup resta separata da questa guida.",
    },
    {
      eyebrow: "Tappa 02 · provider",
      title: "Un modello collegato",
      message:
        "Gli agenti possono lavorare quando il provider previsto dalla tua installazione è configurato. Qui non fingiamo di verificarne lo stato.",
    },
    {
      eyebrow: "Tappa 03 · profilo",
      title: "Indicazioni su ciò che cerchi",
      message:
        "Il Profilo aiuta la squadra a capire obiettivi e preferenze. Potrai correggere le informazioni anche in seguito.",
    },
    {
      eyebrow: "Tappa 04 · conversazione",
      title: "Poi si parte da una domanda",
      message:
        "Quando la tua installazione è pronta, apri la chat e racconta all’Assistente da dove vuoi cominciare.",
    },
  ],
  explore: [
    {
      eyebrow: "Tappa 01 · panoramica",
      title: "Guarda prima la Dashboard",
      message:
        "Puoi esplorare senza completare un tour. La Dashboard è un buon punto di partenza e ogni area resta raggiungibile dalla navigazione.",
    },
    {
      eyebrow: "Tappa 02 · scoperta",
      title: "Apri Map, Posizioni e Swipe",
      message:
        "Queste viste raccontano le opportunità da angolazioni diverse. Esplorarle non conferma né modifica dati da questa guida.",
    },
    {
      eyebrow: "Tappa 03 · persone",
      title: "Conosci Team e Agenti",
      message:
        "Qui trovi le superfici dedicate alla squadra. Puoi tornare all’Assistente in qualunque momento.",
    },
    {
      eyebrow: "Tappa 04 · strumenti personali",
      title: "Completa il giro a modo tuo",
      message:
        "Profilo e Budget completano la panoramica. Quando hai una domanda, passa alla chat libera.",
    },
  ],
};

function validInitialState(state: AssistantOnboardingState | undefined): AssistantOnboardingState {
  if (!state?.path || !Object.hasOwn(GUIDES, state.path)) return INITIAL_ASSISTANT_ONBOARDING_STATE;
  const numericStep = Number(state.step);
  const step = (Number.isInteger(numericStep) ? Math.min(4, Math.max(1, numericStep)) : 1) as AssistantOnboardingStep;
  return { path: state.path, step };
}

export default function AssistantOnboarding({
  assistantName = "Assistente",
  initialState,
  onStateChange,
  onComplete,
  voiceInputBridge,
}: AssistantOnboardingProps) {
  const [state, setState] = useState<AssistantOnboardingState>(() => validInitialState(initialState));
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState(false);
  const [completionVerified, setCompletionVerified] = useState(false);
  const [firstMessage, setFirstMessage] = useState("");
  const dialogueTitle = useRef<HTMLHeadingElement>(null);
  const path = state.path;
  const guide = path ? GUIDES[path][state.step - 1] : null;
  const pathLabel = path ? PATH_LABELS[path] : "";
  const visibleProgress = state.step === 4 && !completionVerified ? 3 : state.step;

  useEffect(() => {
    if (state.step > 0) dialogueTitle.current?.focus();
  }, [state]);

  function move(next: AssistantOnboardingState) {
    setCompletionError(false);
    setCompletionVerified(false);
    setState(next);
    onStateChange?.(next);
  }

  function choose(path: AssistantOnboardingPath) {
    move({ path, step: 1 });
  }

  function back() {
    if (!state.path) return;
    if (state.step === 1) move(INITIAL_ASSISTANT_ONBOARDING_STATE);
    else move({ path: state.path, step: (state.step - 1) as AssistantOnboardingStep });
  }

  async function next() {
    if (!state.path) return;
    if (state.step === 4) {
      if (completing || completionVerified) return;
      setCompleting(true);
      setCompletionError(false);
      try {
        await onComplete(state, firstMessage.trim());
        setCompletionVerified(true);
      } catch {
        setCompletionError(true);
      } finally {
        setCompleting(false);
      }
      return;
    }
    move({ path: state.path, step: (state.step + 1) as AssistantOnboardingStep });
  }

  return (
    <section
      className="assistant-onboarding"
      aria-labelledby="assistant-onboarding-title"
      data-testid="assistant-onboarding-shell"
      style={{ height: "calc(100svh / var(--zoom, 1) - 3.5rem)" }}
    >
      <header className="assistant-onboarding__header">
        <div>
          <p className="assistant-onboarding__kicker">Onboarding Assistente</p>
          <h1 id="assistant-onboarding-title">Conosci l’app, poi continua in chat.</h1>
        </div>
        <div className="assistant-onboarding__progress-copy" aria-hidden="true">
          {visibleProgress}/4
        </div>
        <div
          className="assistant-onboarding__progress"
          role="progressbar"
          aria-label="Avanzamento onboarding Assistente"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={visibleProgress}
        >
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className={step <= visibleProgress ? "is-complete" : undefined} />
          ))}
        </div>
      </header>

      <div className="assistant-onboarding__body" style={{ overflowY: "auto" }}>
        <aside className="assistant-onboarding__identity" aria-label={`Presentazione ${assistantName}`}>
          <div className="assistant-onboarding__portrait" aria-hidden="true">
            <span>AI</span>
          </div>
          <div>
            <p className="assistant-onboarding__role">Guida dell’app</p>
            <h2>{assistantName}</h2>
            <p>
              Ti accompagno tra le aree principali. Questa introduzione non legge lo stato del team e non mostra dati simulati.
            </p>
          </div>
        </aside>

        <div className="assistant-onboarding__dialogue" role="region" aria-label={`Dialogo guidato con ${assistantName}`}>
          {!guide ? (
            <>
              <p className="assistant-onboarding__speaker">{assistantName}</p>
              <h2 ref={dialogueTitle} tabIndex={-1}>Da dove vuoi iniziare?</h2>
              <p className="assistant-onboarding__message">
                Posso mostrarti il percorso, spiegarti cosa serve oppure lasciarti esplorare. Scegli tu: potrai sempre tornare indietro.
              </p>
              <div className="assistant-onboarding__choices" role="group" aria-label="Scegli il percorso di onboarding">
                <button type="button" onClick={() => choose("tour")}>
                  <span>01</span>
                  <strong>Fammi fare il tour</strong>
                  <small>Una panoramica guidata delle aree principali.</small>
                </button>
                <button type="button" onClick={() => choose("requirements")}>
                  <span>02</span>
                  <strong>Che cosa serve per iniziare?</strong>
                  <small>I prerequisiti, senza fingere controlli di stato.</small>
                </button>
                <button type="button" onClick={() => choose("explore")}>
                  <span>03</span>
                  <strong>Preferisco esplorare</strong>
                  <small>Quattro punti di riferimento, poi libertà completa.</small>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="assistant-onboarding__dialogue-meta">
                <span>{pathLabel}</span>
                <span>Tappa {state.step} di 4</span>
              </div>
              <p className="assistant-onboarding__speaker">{assistantName} · {guide.eyebrow}</p>
              <h2 ref={dialogueTitle} tabIndex={-1}>{guide.title}</h2>
              <p className="assistant-onboarding__message" aria-live="polite">{guide.message}</p>
              {state.step === 4 && (
                <div className="assistant-onboarding__composer">
                  <label htmlFor="assistant-first-message">Il tuo primo messaggio all’Assistente</label>
                  <div className="assistant-onboarding__composer-row">
                    <textarea
                      id="assistant-first-message"
                      rows={3}
                      value={firstMessage}
                      onChange={(event) => setFirstMessage(event.target.value)}
                      disabled={completing || completionVerified}
                      placeholder="Scrivi o detta da dove vuoi cominciare…"
                    />
                    <VoiceInputControl
                      value={firstMessage}
                      onChange={setFirstMessage}
                      locale="it-IT"
                      bridge={voiceInputBridge}
                      disabled={completing || completionVerified}
                      className="assistant-onboarding__voice"
                    />
                  </div>
                  <small>La trascrizione resta modificabile e sarà consegnata solo quando confermi.</small>
                </div>
              )}
              {completionError && (
                <p className="assistant-onboarding__error" role="alert">
                  Non riesco ad aprire la chat. Riprova: il percorso non è stato segnato come completato.
                </p>
              )}
              <div className="assistant-onboarding__actions">
                <button type="button" className="assistant-onboarding__back" onClick={back} disabled={completing || completionVerified}>
                  <span aria-hidden="true">←</span> Indietro
                </button>
                <button
                  type="button"
                  className="assistant-onboarding__next"
                  onClick={() => void next()}
                  disabled={completionVerified || completing || (state.step === 4 && !firstMessage.trim())}
                >
                  {completionVerified
                    ? "Chat verificata"
                    : completing
                    ? "Apro la chat…"
                    : state.step === 4
                      ? completionError
                        ? "Riprova e apri la chat"
                        : "Passa alla chat libera"
                      : "Avanti"}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
