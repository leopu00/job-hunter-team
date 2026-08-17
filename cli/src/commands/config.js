import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';
import { writePrivateJson } from '../lib/secure-config-io.js';

const CONFIG_DIR = JHT_HOME;
const CONFIG_FILE = join(CONFIG_DIR, 'jht.config.json');

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveConfig(config) {
  writePrivateJson(CONFIG_FILE, config);
}

function getNestedValue(obj, keyPath) {
  const keys = keyPath.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function setNestedValue(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  // Try to parse as JSON for booleans/numbers, fallback to string
  try {
    current[keys[keys.length - 1]] = JSON.parse(value);
  } catch {
    current[keys[keys.length - 1]] = value;
  }
}

async function handleGet(keyPath) {
  const config = await loadConfig();
  if (!config) {
    console.error('No configuration found. Run: jht setup');
    process.exitCode = 1;
    return;
  }

  if (!keyPath) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  const value = getNestedValue(config, keyPath);
  if (value === undefined) {
    console.error(`Key "${keyPath}" not found.`);
    process.exitCode = 1;
    return;
  }

  if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

async function handleSet(keyPath, value) {
  if (!keyPath || value === undefined) {
    console.error('Usage: jht config set <key> < value>');
    process.exitCode = 1;
    return;
  }

  let config = await loadConfig();
  if (!config) {
    config = {};
  }

  setNestedValue(config, keyPath, value);
  await saveConfig(config);
  console.log(`${keyPath} = ${JSON.stringify(getNestedValue(config, keyPath))}`);
}

export function registerConfigCommand(program) {
  const config = program
    .command('config')
    .description('Configuration management (get/set)');

  config
    .command('get [key]')
    .description('Show all configuration or one key (for example, jht config get web.port)')
    .action(handleGet);

  config
    .command('set <key> <value>')
    .description('Set a value (for example, jht config set provider anthropic)')
    .action(handleSet);
}
