/**
 * JHT CLI — Comandi cron: gestione job schedulati
 */
import { CronService } from '../../../shared/cron/index.js';

function formatMs(ms) {
  if (ms == null) return '-';
  const d = new Date(ms);
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' });
}

function formatDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function createService() {
  return new CronService({
    onExecute: async (job) => {
      console.log(`  Job execution "${job.name}" (${job.id})...`);
      console.log(`  Payload: ${JSON.stringify(job.payload)}`);
      return { status: 'ok' };
    },
  });
}

async function handleList(opts) {
  const svc = createService();
  await svc.start();
  const jobs = await svc.list({ includeDisabled: opts.all });
  svc.stop();

  if (jobs.length === 0) {
    console.log('No job configured.');
    return;
  }

  console.log(`\n  Job schedulati (${jobs.length}):\n`);
  for (const job of jobs) {
    const status = job.enabled ? 'enabled' : 'disabled';
    const next = formatMs(job.state.nextRunAtMs);
    const last = formatMs(job.state.lastRunAtMs);
    const lastStatus = job.state.lastRunStatus || '-';
    console.log(`  ${job.name}`);
    console.log(`    ID:      ${job.id}`);
    console.log(`    State:   ${status}`);
    console.log(`    Next:  ${next}`);
    console.log(`    Last:  ${last} (${lastStatus})`);
    if (job.state.lastError) console.log(`    Error:  ${job.state.lastError}`);
    console.log('');
  }
}

async function handleAdd(name, opts) {
  if (!opts.schedule) {
    console.error('--schedule is required (cron expression or "every:Xm/h/s")');
    process.exitCode = 1;
    return;
  }

  const schedule = parseScheduleOption(opts.schedule);
  if (!schedule) {
    console.error('Invalid schedule format. Examples: "0 9 * * *", "every:30m", "at:2026-04-04T09:00"');
    process.exitCode = 1;
    return;
  }

  const svc = createService();
  await svc.start();
  const job = await svc.add({
    name,
    description: opts.description || '',
    schedule,
    payload: opts.payload ? JSON.parse(opts.payload) : { kind: 'command', command: name },
    deleteAfterRun: opts.once || false,
  });
  svc.stop();

  console.log(`Job created: "${job.name}" (${job.id})`);
  console.log(`  Next run: ${formatMs(job.state.nextRunAtMs)}`);
}

function parseScheduleOption(raw) {
  if (raw.startsWith('every:')) {
    const val = raw.slice(6);
    const match = val.match(/^(\d+)(s|m|h)$/);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers = { s: 1000, m: 60_000, h: 3_600_000 };
    return { kind: 'every', everyMs: num * multipliers[unit] };
  }
  if (raw.startsWith('at:')) {
    const ts = raw.slice(3);
    const ms = Date.parse(ts);
    if (isNaN(ms)) return null;
    return { kind: 'at', at: ts };
  }
  // Assume cron expression
  return { kind: 'cron', expr: raw };
}

async function handleRemove(id) {
  const svc = createService();
  await svc.start();
  const { removed } = await svc.remove(id);
  svc.stop();

  if (removed) {
    console.log(`Job ${id} removed.`);
  } else {
    console.error(`Job ${id} not found.`);
    process.exitCode = 1;
  }
}

async function handleRun(id, opts) {
  const mode = opts.force ? 'force' : 'due';
  const svc = createService();
  await svc.start();
  try {
    const result = await svc.run(id, mode);
    if (result.ran) {
      console.log(`Job ${id} executed.`);
    } else {
      console.log(`Job ${id} not executed (${result.reason}).`);
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
  svc.stop();
}

async function handleStatus() {
  const svc = createService();
  await svc.start();
  const info = await svc.status();
  svc.stop();

  console.log('\n  Cron — State\n');
  console.log(`  Store:     ${info.storePath}`);
  console.log(`  Job:       ${info.jobs}`);
  console.log(`  Next:  ${formatMs(info.nextWakeAtMs)}`);
  console.log('');
}

export function registerCronCommand(program) {
  const cron = program
    .command('cron')
    .description('Manage scheduled jobs');

  cron.command('list')
    .description('Show all jobs')
    .option('-a, --all', 'Include disabled jobs')
    .action(handleList);

  cron.command('add <name>')
    .description('Add a job (e.g. jht cron add "research" --schedule "0 9 * *")')
    .requiredOption('-s, --schedule <expr>', 'Schedule: cron expr, "every:30m", "at:ISO"')
    .option('-d, --description <desc>', 'description')
    .option('-p, --payload <json>', 'Payload JSON')
    .option('--once', 'Delete after first run')
    .action(handleAdd);

  cron.command('remove <id>')
    .description('Remove a job for ID')
    .action(handleRemove);

  cron.command('run <id>')
    .description('Run a job manually')
    .option('-f, --force', 'run even when the job is not due')
    .action(handleRun);

  cron.command('status')
    .description('Show status of cron system')
    .action(handleStatus);
}
