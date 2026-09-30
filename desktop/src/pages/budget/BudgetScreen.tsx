import { useState, type ReactNode } from "react";
import type { SpendRead } from "../../lib/spend";
import {
  agentsOfRun,
  budgetShare,
  formatCount,
  formatMinutes,
  formatPercent,
  formatUsagePercent,
  formatUsd,
  formatWhen,
  roleLabel,
  runStatusLabel,
  spendByRole,
  totals,
  usageWindow,
} from "./budget-model";
import type { UsageRead } from "./load-usage";

/**
 * The budget page. Two sources, told apart on screen:
 *  - the API team of this computer: its runs' database, read only through
 *    the api_team_spend command (runs, spend against budget, per role and
 *    per agent, the caps the app gives every run);
 *  - the tmux team's usage window (5 hours, week, reset, projection): the
 *    sentinel bridge's samples on the cloud (sentinel_ticks), read with the
 *    user's session. That team runs on a subscription, so what it consumes is
 *    a share of the provider's windows, not dollars.
 */
export default function BudgetScreen({ spend, usage, now = Date.now() }: { spend: SpendRead; usage: UsageRead | null; now?: number }) {
  return (
    <div className="max-w-6xl mx-auto px-5 pt-8 pb-10" style={{ animation: "fade-in 0.35s ease both" }}>
      <h1 className="text-xl font-bold uppercase tracking-[0.18em] leading-none mb-2" style={{ color: "var(--color-white)" }}>
        Budget
      </h1>
      <p className="text-[11px] text-[var(--color-muted)] mb-6 m-0">
        Quanto spende il team API di questo computer, dal database dei suoi run, e quanto consuma il team tmux, dal cloud
        (sola lettura).
      </p>
      <ApiTeamSpend spend={spend} />
      <TmuxTeamUsage usage={usage} now={now} />
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
          Nessun run API storico su questo computer. Il percorso 0.4 usa il provider in abbonamento configurato durante l’onboarding.
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

/** The tmux team's usage window, from the bridge's samples on the cloud. */
function TmuxTeamUsage({ usage, now }: { usage: UsageRead | null; now: number }) {
  const title = "Consumo del team tmux";
  if (usage == null)
    return (
      <Section title={title}>
        <p className="m-0 text-[11px] text-[var(--color-muted)]">Caricamento del consumo dal cloud…</p>
      </Section>
    );
  if (usage.state === "failed")
    return (
      <Section title={title}>
        <p role="alert" className="m-0 text-[11px]" style={{ color: "var(--color-red)" }}>
          Non riesco a leggere il consumo del team tmux dal cloud. Riprova con «Aggiorna».
        </p>
      </Section>
    );
  const w = usageWindow(usage.samples, now);
  if (!w)
    return (
      <Section title={title}>
        <UsageTiles />
        <p className="m-0 text-[11px] text-[var(--color-muted)]">
          Nessun campione sul cloud: il team tmux non ha ancora mandato il suo consumo. Lo manda il daemon cloud del
          computer del team, al massimo ogni quarto d'ora.
        </p>
      </Section>
    );
  const { latest } = w;
  const resetAt = latest.resetAtUnix != null ? new Date(latest.resetAtUnix * 1000).toISOString() : null;
  const velocity = latest.velocity != null ? `${latest.velocity.toFixed(1).replace(".", ",")}% l'ora` : undefined;
  return (
    <>
      <Section title={title}>
        <UsageTiles
          window={{ value: formatUsagePercent(latest.usage), hint: `${latest.provider} · ${latest.status}` }}
          week={{
            value: formatUsagePercent(latest.weeklyUsage),
            hint: w.weeklyResetInMinutes != null ? `reset tra ${formatMinutes(w.weeklyResetInMinutes)}` : undefined,
          }}
          reset={{ value: formatMinutes(w.resetInMinutes), hint: resetAt ? formatWhen(resetAt) : undefined }}
          projection={{
            value: formatUsagePercent(latest.projection),
            hint: [velocity, latest.throttle ? `throttle ${latest.throttle}` : undefined].filter(Boolean).join(" · ") || undefined,
          }}
        />
        <p
          role={w.stale ? "status" : undefined}
          className="m-0 text-[11px]"
          style={{ color: w.stale ? "var(--color-yellow)" : "var(--color-muted)" }}
        >
          {w.stale
            ? `Ultimo campione del ${formatWhen(latest.ts)}: da allora non ne sono arrivati, il team potrebbe essere fermo.`
            : `Ultimo campione del ${formatWhen(latest.ts)}, dal cloud.`}
        </p>
      </Section>

      <Section title="Campioni del team tmux">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[var(--color-dim)]">
              <Th>Ora</Th>
              <Th>Provider</Th>
              <Th right>5 ore</Th>
              <Th right>Settimana</Th>
              <Th right>Proiezione</Th>
              <Th>Stato</Th>
              <Th right>Throttle</Th>
            </tr>
          </thead>
          <tbody>
            {usage.samples.map((s) => (
              <tr key={`${s.ts}:${s.provider}`} className="border-t border-[var(--color-border)]">
                <Td>{formatWhen(s.ts)}</Td>
                <Td>{s.provider}</Td>
                <Td right>{formatUsagePercent(s.usage)}</Td>
                <Td right>{formatUsagePercent(s.weeklyUsage)}</Td>
                <Td right>{formatUsagePercent(s.projection)}</Td>
                <Td>{s.status}</Td>
                <Td right>{s.throttle ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

type TileText = { value: string; hint?: string | undefined };

function UsageTiles({ window, week, reset, projection }: { window?: TileText; week?: TileText; reset?: TileText; projection?: TileText }) {
  const none: TileText = { value: "—" };
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
      <Tile label="Finestra 5 ore" {...(window ?? none)} />
      <Tile label="Settimana" {...(week ?? none)} />
      <Tile label="Prossimo reset" {...(reset ?? none)} />
      <Tile label="Proiezione" {...(projection ?? none)} />
    </div>
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

function Tile({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
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
