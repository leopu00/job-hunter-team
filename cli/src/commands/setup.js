import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const CONFIG_DIR = join(process.env.HOME || '', '.jht');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  provider: 'openai',
  model: 'gpt-4',
  dataDir: '../data',
  web: { port: 3000 },
  agents: {},
};

async function prompt(rl, question, defaultValue) {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function configExists() {
  try {
    await access(CONFIG_FILE);
    return true;
  } catch {
    return false;
  }
}

async function runSetupWizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  Job Hunter Team — Setup Wizard\n');

  const exists = await configExists();
  if (exists) {
    const overwrite = await prompt(rl, 'Config gia\' presente. Sovrascrivere? (y/N)', 'N');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Setup annullato.');
      rl.close();
      return;
    }
  }

  const provider = await prompt(rl, 'AI provider', DEFAULT_CONFIG.provider);
  const model = await prompt(rl, 'Modello', DEFAULT_CONFIG.model);
  const dataDir = await prompt(rl, 'Directory dati', DEFAULT_CONFIG.dataDir);
  const webPort = await prompt(rl, 'Porta web', String(DEFAULT_CONFIG.web.port));

  const config = {
    provider,
    model,
    dataDir,
    web: { port: parseInt(webPort, 10) },
    agents: {},
  };

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log(`\nConfig salvata in ${CONFIG_FILE}`);
  console.log('Setup completato!\n');

  rl.close();
}

export function registerSetupCommand(program) {
  program
    .command('setup')
    .description('Wizard di configurazione iniziale')
    .action(runSetupWizard);
}
