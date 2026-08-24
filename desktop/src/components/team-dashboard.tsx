import { useState } from "react";
import type {
  TeamAgentActivity,
  TeamProgress,
  TeamRole,
  TeamStartResult,
} from "../lib/team";

const AGENTS: Array<{ id: string; role: TeamRole; label: string }> = [
  { id: "captain-1", role: "captain", label: "Capitano" },
  { id: "sentinel-1", role: "sentinel", label: "Sentinella" },
  { id: "scout-1", role: "scout", label: "Scout" },
  { id: "analyst-1", role: "analyst", label: "Analista 1" },
  { id: "analyst-2", role: "analyst", label: "Analista 2" },
  { id: "scorer-1", role: "scorer", label: "Scorer 1" },
  { id: "scorer-2", role: "scorer", label: "Scorer 2" },
  { id: "writer-1", role: "writer", label: "Scrittore 1" },
  { id: "writer-2", role: "writer", label: "Scrittore 2" },
  { id: "critic-1", role: "critic", label: "Critico 1" },
  { id: "critic-2", role: "critic", label: "Critico 2" },
];

const ROLE_LABELS: Record<TeamRole, string> = {
  captain: "Capitano",
  scout: "Scout",
  analyst: "Analista",
  scorer: "Scorer",
  writer: "Scrittore",
  critic: "Critico",
  sentinel: "Sentinella",
};

const STAGES: TeamProgress["stage"][] = [
  "podman",
  "credentials",
  "image",
  "team",
];

function activityText(event: TeamAgentActivity): string {
  const role = ROLE_LABELS[event.role];
  if (event.status === "working") {
    if (event.positionTitle) return `${role} lavora su ${event.positionTitle}`;
    if (event.role === "captain") return "Il Capitano assegna il lavoro";
    if (event.role === "scout") return "Scout cerca nuove posizioni";
    if (event.role === "sentinel")
      return "Sentinella verifica budget e sicurezza";
    return `${role} è al lavoro`;
  }
  if (event.positionTitle)
    return `${role} ha completato ${event.positionTitle}`;
  return `${role} ha completato il proprio incarico`;
}

export function TeamLiveDashboard({
  progress,
  activity,
}: {
  progress: TeamProgress;
  activity: TeamAgentActivity[];
}) {
  const latestByAgent = new Map<string, TeamAgentActivity>();
  for (const event of activity) latestByAgent.set(event.agentId, event);
  const activeIndex = STAGES.indexOf(progress.stage);

  return (
    <section className="live-team" aria-live="polite">
      <div className="live-team__activity">
        <p className="eyebrow">Esecuzione in tempo reale</p>
        <h1>
          La squadra
          <br />
          <em>è al lavoro.</em>
        </h1>
        <p className="live-team__current">
          <i /> {progress.message}
        </p>

        <div className="stage-strip" aria-label="Preparazione del team">
          {STAGES.map((stage, index) => (
            <span
              key={stage}
              className={index <= activeIndex ? "is-active" : ""}
            >
              {index < activeIndex ? "✓" : index + 1}
            </span>
          ))}
        </div>

        <div className="activity-feed">
          <div className="section-heading">
            <span>Attività</span>
            <b>{activity.length} eventi</b>
          </div>
          {activity.length === 0 ? (
            <p className="empty-activity">
              Preparazione dell’ambiente isolato…
            </p>
          ) : (
            <ol>
              {activity
                .slice(-7)
                .reverse()
                .map((event, index) => (
                  <li
                    key={`${event.agentId}-${event.status}-${event.positionTitle ?? "team"}-${activity.length - index}`}
                  >
                    <i
                      className={`activity-dot activity-dot--${event.status}`}
                    />
                    <div>
                      <strong>{activityText(event)}</strong>
                      <small>{event.agentId}</small>
                    </div>
                  </li>
                ))}
            </ol>
          )}
        </div>
      </div>

      <aside className="agent-board">
        <div className="section-heading">
          <div>
            <span>Runtime locale</span>
            <h2>Agenti del team</h2>
          </div>
          <b>{AGENTS.length} istanze</b>
        </div>
        <div className="agent-group-label">Coordinamento</div>
        <div className="agent-grid agent-grid--core">
          {AGENTS.slice(0, 2).map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              activity={latestByAgent.get(agent.id)}
            />
          ))}
        </div>
        <div className="agent-group-label">Pipeline</div>
        <div className="agent-grid">
          {AGENTS.slice(2).map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              activity={latestByAgent.get(agent.id)}
            />
          ))}
        </div>
        <p className="live-safety">
          La chiave resta nel secret temporaneo. Il costo totale non può
          superare $0,10.
        </p>
      </aside>
    </section>
  );
}

function AgentRow({
  agent,
  activity,
}: {
  agent: (typeof AGENTS)[number];
  activity?: TeamAgentActivity;
}) {
  const state = activity?.status ?? "queued";
  return (
    <div className={`agent-row agent-row--${state}`}>
      <span className="agent-avatar">{agent.label.slice(0, 2)}</span>
      <div>
        <strong>{agent.label}</strong>
        <small>{activity?.positionTitle ?? agent.id}</small>
      </div>
      <span className="agent-state">
        {state === "working"
          ? "al lavoro"
          : state === "completed"
            ? "completato"
            : "in attesa"}
      </span>
    </div>
  );
}

type ResultTab = "positions" | "agents" | "activity";

export function ResultExplorer({ result }: { result: TeamStartResult }) {
  const [tab, setTab] = useState<ResultTab>("positions");
  const [selectedSourceId, setSelectedSourceId] = useState(
    result.positions[0]?.sourceId ?? "",
  );
  const selected = result.positions.find(
    (position) => position.sourceId === selectedSourceId,
  );

  return (
    <aside className="positions-card result-explorer">
      <div className="positions-card__heading">
        <div>
          <span>Output verificato</span>
          <h2>Risultati del team</h2>
        </div>
        <b>{result.runId.slice(0, 8)}</b>
      </div>
      <div
        className="result-tabs"
        role="tablist"
        aria-label="Risultati del team"
      >
        <TabButton
          active={tab === "positions"}
          onClick={() => setTab("positions")}
        >
          Posizioni
        </TabButton>
        <TabButton active={tab === "agents"} onClick={() => setTab("agents")}>
          Agenti
        </TabButton>
        <TabButton
          active={tab === "activity"}
          onClick={() => setTab("activity")}
        >
          Attività
        </TabButton>
      </div>

      {tab === "positions" && (
        <div className="position-results">
          <ol className="position-list">
            {result.positions.map((position) => (
              <li key={position.sourceId}>
                <button
                  type="button"
                  className={
                    position.sourceId === selectedSourceId ? "is-selected" : ""
                  }
                  onClick={() => setSelectedSourceId(position.sourceId)}
                >
                  <div>
                    <strong>{position.title}</strong>
                    <small>{position.company}</small>
                  </div>
                  <span>{position.score}</span>
                </button>
              </li>
            ))}
          </ol>
          {selected && (
            <div className="position-detail">
              <div className="position-detail__meta">
                <span>
                  <small>Stato</small>
                  <strong>{stateLabel(selected.state)}</strong>
                </span>
                <span>
                  <small>Critico</small>
                  <strong>{selected.criticScore?.toFixed(1) ?? "—"}</strong>
                </span>
                <span>
                  <small>Verdetto</small>
                  <strong>{selected.criticVerdict ?? "non revisionato"}</strong>
                </span>
              </div>
              {selected.cvMarkdown ? (
                <div className="cv-preview">
                  <span>CV generato</span>
                  <pre>{selected.cvMarkdown}</pre>
                </div>
              ) : (
                <p className="empty-detail">
                  Per questa posizione il test non ha richiesto un CV.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "agents" && (
        <ol className="usage-list">
          {result.agents.map((agent) => (
            <li key={agent.agentId}>
              <div>
                <strong>{agent.agentId}</strong>
                <small>{ROLE_LABELS[agent.role]}</small>
              </div>
              <div>
                <strong>${agent.costUsd.toFixed(4)}</strong>
                <small>{agent.inputTokens + agent.outputTokens} token</small>
              </div>
            </li>
          ))}
        </ol>
      )}

      {tab === "activity" && (
        <ol className="result-timeline">
          {result.timeline
            .slice()
            .reverse()
            .map((event) => (
              <li key={event.sequence}>
                <span>{event.sequence}</span>
                <div>
                  <strong>
                    {event.actor} · {eventLabel(event.event)}
                  </strong>
                  <small>
                    {event.from && event.to
                      ? `${event.from} → ${event.to}`
                      : (event.sourceId ?? "team")}
                  </small>
                </div>
              </li>
            ))}
        </ol>
      )}

      <p className="workspace-path" title={result.workspacePath}>
        Salvato in <code>{result.workspacePath}</code>
      </p>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "is-active" : ""}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function stateLabel(state: string): string {
  return (
    (
      {
        reviewed: "revisionato",
        scored: "valutato",
        excluded: "escluso",
      } as Record<string, string>
    )[state] ?? state
  );
}

function eventLabel(event: string): string {
  return event.replaceAll("_", " ");
}
