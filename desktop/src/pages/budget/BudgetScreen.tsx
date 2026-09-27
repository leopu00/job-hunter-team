import { useState, type ReactNode } from "react";
import type { SpendRead } from "../../lib/spend";
import { SETUP_PAGE } from "../../lib/pages";
import {
  agentsOfRun,
  budgetShare,
  formatCount,
  formatPercent,
  formatUsd,
  formatWhen,
  roleLabel,
  runStatusLabel,
  spendByRole,
  totals,
} from "./budget-model";

/**
 * The budget page. Two sources, told apart on screen:
 *  - the API team of this computer: its runs' database, read only through
 *    the api_team_spend command (runs, spend against budget, per role and
 *    per agent, the caps the app gives every run);
 *  - the tmux team's usage window (5 hours, week, reset): those numbers stay
 *    in the team's container and do not reach the cloud, so they are «—».
 */
export default function BudgetScreen({ spend }: { spend: SpendRead }) {
  return (
    <div className="max-w-6xl mx-auto px-5 pt-8 pb-10" style={{ animation: "fade-in 0.35s ease both" }}>
      <h1 className="text-xl font-bold uppercase tracking-[0.18em] leading-none mb-2" style={{ color: "var(--color-white)" }}>
        Budget
      </h1>
      <p className="text-[11px] text-[var(--color-muted)] mb-6 m-0">
        Quanto spende il team API di questo computer, dal database dei suoi run (sola lettura).
      </p>
      <ApiTeamSpend spend={spend} />
      <TmuxTeamUsage />
    </div>
  );
}

function ApiTeamSpend({ spend }: { spend: SpendRead }) {
  if (spend.state === "unavailable")
    return <Notice>La spesa del team API si legge solo dall'app desktop: qui non c'è il suo database.</Notice>;
  if (spend.state === "failed")
    return (
      <Notice tone="red">
        Non riesco a leggere il database dei run. Riprova con «Aggiorna».
      </Notice>
    );
  const { report } = spend;
  if (!report.found || report.runs.length === 0)
    return (
      <>
        <Caps team={report.teamCapUsd} agent={report.agentCapUsd} />
        <Notice>
          Nessun run del team API su questo computer. Si avvia da{" "}
          <a href={SETUP_PAGE} className="text-[var(--color-blue)] no-underline hover:text-[var(--color-bright)]">
            Team locale
          </a>
          .
        </Notice>
      </>
    );
  return <Runs spend={spend} />;
}

function Runs({ spend }: { spend: Extract<SpendRead, { state: "ready" }> }) {
  const { report } = spend;
  const t = totals(report);
  const [selected, setSelected] = useState(report.runs[0].runId);
  const run = report.runs.find((r) => r.runId === selected) ?? report.runs[0];
  const roles = spendByRole(report.agents, run.runId);
  const agents = agentsOfRun(report.agents, run.runId);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Tile label="Speso in totale" value={formatUsd(t.spentUsd)} hint={`su ${t.runs} run`} />
        <Tile
          label="Ultimo run"
          value={t.latest ? formatUsd(t.latest.spentUsd) : "—"}
          hint={t.latest ? `${runStatusLabel(t.latest.status)} · ${formatWhen(t.latest.createdAt)}` : undefined}
        />
        <Tile label="Tetto per run" value={formatUsd(report.teamCapUsd)} hint="per tutto il team" />
        <Tile label="Tetto per agente" value={formatUsd(report.agentCapUsd)} hint="per ogni agente" />
      </div>

      <Section title="Run">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[var(--color-dim)]">
              <Th>Avvio</Th>
              <Th>Stato</Th>
              <Th right>Budget</Th>
              <Th right>Speso</Th>
              <Th>Del budget</Th>
            </tr>
          </thead>
          <tbody>
            {report.runs.map((r) => {
              const share = budgetShare(r);
              const on = r.runId === run.runId;
              return (
                <tr
                  key={r.runId}
                  aria-selected={on}
                  onClick={() => setSelected(r.runId)}
                  className="cursor-pointer border-t border-[var(--color-border)] hover:bg-[var(--color-card)]"
                  style={{ background: on ? "var(--color-card)" : undefined }}
                >
                  <Td>{formatWhen(r.createdAt)}</Td>
                  <Td>
                    <span style={{ color: r.status === "failed" ? "var(--color-red)" : undefined }}>{runStatusLabel(r.status)}</span>
                  </Td>
                  <Td right>{formatUsd(r.budgetUsd)}</Td>
                  <Td right>{formatUsd(r.spentUsd)}</Td>
                  <Td>
                    <ShareBar share={share} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title={`Per ruolo · run del ${formatWhen(run.createdAt)}`}>
        {roles.length === 0 ? (
          <p className="m-0 text-[11px] text-[var(--color-muted)]">Nessun agente registrato in questo run.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[var(--color-dim)]">
                <Th>Ruolo</Th>
                <Th right>Agenti</Th>
                <Th right>Compiti</Th>
                <Th right>Costo</Th>
                <Th right>Token in</Th>
                <Th right>Token out</Th>
                <Th>Ultimo errore</Th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.role} className="border-t border-[var(--color-border)]">
                  <Td>{roleLabel(r.role)}</Td>
                  <Td right>{r.agents}</Td>
                  <Td right>{r.tasks}</Td>
                  <Td right>{formatUsd(r.costUsd)}</Td>
                  <Td right>{formatCount(r.inputTokens)}</Td>
                  <Td right>{formatCount(r.outputTokens)}</Td>
                  <Td>
                    {r.lastError ? (
                      <span style={{ color: "var(--color-red)" }}>
                        {r.lastError.message}
                        {r.lastError.agentId ? ` (${r.lastError.agentId})` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {agents.length > 0 && (
        <Section title="Per agente">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[var(--color-dim)]">
                <Th>Agente</Th>
                <Th>Ruolo</Th>
                <Th>Stato</Th>
                <Th right>Costo</Th>
                <Th>Del tetto</Th>
                <Th right>Token in</Th>
                <Th right>Token out</Th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={`${a.role}:${a.agentId ?? ""}`} className="border-t border-[var(--color-border)]">
                  <Td>{a.agentId ?? "non assegnato"}</Td>
                  <Td>{roleLabel(a.role)}</Td>
                  <Td>{a.status ?? "—"}</Td>
                  <Td right>{formatUsd(a.costUsd)}</Td>
                  <Td>
                    <ShareBar share={report.agentCapUsd > 0 ? a.costUsd / report.agentCapUsd : null} />
                  </Td>
                  <Td right>{formatCount(a.inputTokens)}</Td>
                  <Td right>{formatCount(a.outputTokens)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}

/** The tmux team's usage window: known in its container, never on the cloud. */
function TmuxTeamUsage() {
  return (
    <Section title="Consumo del team tmux">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Tile label="Finestra 5 ore" value="—" />
        <Tile label="Settimana" value="—" />
        <Tile label="Prossimo reset" value="—" />
        <Tile label="Proiezione" value="—" />
      </div>
      <p className="m-0 text-[11px] text-[var(--color-muted)]">
        Non arriva al cloud: questi numeri restano nel container del team.
      </p>
    </Section>
  );
}

function Caps({ team, agent }: { team: number; agent: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <Tile label="Tetto per run" value={formatUsd(team)} hint="per tutto il team" />
      <Tile label="Tetto per agente" value={formatUsd(agent)} hint="per ogni agente" />
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3">
      <div className="text-[9px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-1">{label}</div>
      <div className="text-[16px] font-bold text-[var(--color-white)]">{value}</div>
      {hint && <div className="text-[10px] text-[var(--color-muted)] mt-0.5">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6" aria-label={title}>
      <h2 className="text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] mb-2 m-0">{title}</h2>
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 overflow-x-auto">{children}</div>
    </section>
  );
}

function ShareBar({ share }: { share: number | null }) {
  const width = share == null ? 0 : Math.min(100, Math.max(0, share * 100));
  const over = share != null && share >= 1;
  return (
    <span className="flex items-center gap-2">
      <span className="inline-block w-20 h-1.5 rounded bg-[var(--color-card)] overflow-hidden">
        <span
          className="block h-full"
          style={{ width: `${width}%`, background: over ? "var(--color-red)" : "var(--color-green)" }}
        />
      </span>
      <span className="text-[var(--color-muted)]">{formatPercent(share)}</span>
    </span>
  );
}

function Notice({ children, tone }: { children: ReactNode; tone?: "red" }) {
  return (
    <p
      role={tone === "red" ? "alert" : undefined}
      className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 text-[11px] mb-6 m-0"
      style={{ color: tone === "red" ? "var(--color-red)" : "var(--color-muted)" }}
    >
      {children}
    </p>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={"py-1.5 pr-3 font-semibold" + (right ? " text-right" : "")}>{children}</th>;
}

function Td({ children, right }: { children: ReactNode; right?: boolean }) {
  return <td className={"py-1.5 pr-3 text-[var(--color-base)]" + (right ? " text-right tabular-nums" : "")}>{children}</td>;
}
