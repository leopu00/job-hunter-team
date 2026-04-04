/**
 * JHT Setup Wizard — SecretRef pattern
 *
 * API keys mai in plaintext nel config. Il config salva un riferimento
 * (env var, file, exec) che viene risolto a runtime.
 *
 * Pattern copiato da OpenClaw (openclaw/src/config/).
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * SecretInput shape salvata in config.json:
 *   { type: "plaintext", value: "sk-ant-..." }
 *   { type: "ref", source: "env",  id: "ANTHROPIC_API_KEY" }
 *   { type: "ref", source: "file", path: "/run/secrets/api-key" }
 *   { type: "ref", source: "exec", command: "op read ..." }
 */

/**
 * Risolve un SecretInput al suo valore effettivo.
 * @param {object} secret
 * @returns {string}
 */
export function resolveSecret(secret) {
  if (!secret) return '';
  if (typeof secret === 'string') return secret; // legacy plaintext
  if (secret.type === 'plaintext') return secret.value ?? '';
  if (secret.type !== 'ref') return '';

  switch (secret.source) {
    case 'env':
      return process.env[secret.id] ?? '';
    case 'file':
      try { return readFileSync(secret.path, 'utf-8').trim(); }
      catch { return ''; }
    case 'exec':
      try { return execSync(secret.command, { encoding: 'utf-8', timeout: 5000 }).trim(); }
      catch { return ''; }
    default:
      return '';
  }
}

/**
 * Crea un SecretInput dal modo scelto dall'utente.
 * @param {"plaintext"|"env"|"file"} mode
 * @param {string} value — la key, il nome env var, o il path file
 * @returns {object}
 */
export function formatSecretForConfig(mode, value) {
  if (mode === 'env') return { type: 'ref', source: 'env', id: value };
  if (mode === 'file') return { type: 'ref', source: 'file', path: value };
  return { type: 'plaintext', value };
}

/**
 * Descrizione leggibile di un SecretInput per il riepilogo.
 * @param {object} secret
 * @returns {string}
 */
export function describeSecret(secret) {
  if (!secret) return 'non configurato';
  if (typeof secret === 'string') return `plaintext (${secret.slice(0, 8)}****)`;
  if (secret.type === 'plaintext') return `plaintext (${(secret.value ?? '').slice(0, 8)}****)`;
  if (secret.type === 'ref') {
    if (secret.source === 'env') return `env:${secret.id}`;
    if (secret.source === 'file') return `file:${secret.path}`;
    if (secret.source === 'exec') return `exec:${secret.command.slice(0, 30)}`;
  }
  return 'sconosciuto';
}
