// Comando team start
import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, claudeAvailable, isSessionActive,
  sessionName, parseAgentArg, resolveConfig, getWorkspace,
} from './agents.js';

export function startAction(agentArg, options) {
  if (!tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato. Installa con: brew install tmux'));
    process.exit(1);
  }
  if (!claudeAvailable()) {
    console.error(c.red('Errore: Claude CLI non trovato.'));
    process.exit(1);
  }

  const workspace = getWorkspace();
  if (!workspace) {
    console.error(c.red('Errore: JHT_WORKSPACE non configurato.'));
    process.exit(1);
  }

  const { repoRoot } = resolveConfig();
  const mode = options.mode || 'default';
  const targets = agentArg ? [agentArg] : DEFAULT_TEAM;

  console.log('');
  console.log(c.bold('Avvio agenti...'));
  console.log(c.dim(`  Mode: ${mode} | Workspace: ${workspace}`));
  console.log('');

  let started = 0;
  let skipped = 0;

  for (const target of targets) {
    const parsed = parseAgentArg(target);
    if (!parsed) {
      console.log(`  ${c.red('✗')} ${target} — ruolo non riconosciuto`);
      continue;
    }

    const { role, instance } = parsed;
    const agent = AGENTS.find((a) => a.role === role);
    const sName = sessionName(role, instance);

    if (isSessionActive(sName)) {
      console.log(`  ${c.yellow('⏭')} ${sName} — gia attivo`);
      skipped++;
      continue;
    }

    let effort = agent.effort;
    if (mode === 'fast') effort = 'low';

    const agentDir = agent.multi
      ? join(workspace, `${role}-${instance}`)
      : join(workspace, role);

    if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

    if (repoRoot) {
      const template = join(repoRoot, 'agents', role, `${role}.md`);
      const dest = join(agentDir, 'CLAUDE.md');
      if (!existsSync(dest) && existsSync(template)) copyFileSync(template, dest);
    }

    try {
      execSync(`tmux new-session -d -s "${sName}" -c "${agentDir}"`, { stdio: 'ignore' });
      execSync(`tmux send-keys -t "${sName}" "claude --dangerously-skip-permissions --effort ${effort}" C-m`, { stdio: 'ignore' });
      spawn('bash', ['-c', `sleep 4 && tmux send-keys -t "${sName}" Enter && sleep 3 && tmux send-keys -t "${sName}" Enter`], {
        detached: true, stdio: 'ignore',
      }).unref();
      console.log(`  ${c.green('✓')} ${sName} avviato (effort: ${effort})`);
      started++;
    } catch (err) {
      console.log(`  ${c.red('✗')} ${sName} — errore avvio: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Risultato: ${c.green(started + ' avviati')}, ${c.yellow(skipped + ' gia attivi')}`);
  console.log('');
}
