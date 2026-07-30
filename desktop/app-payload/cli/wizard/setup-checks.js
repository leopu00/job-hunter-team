/**
 * JHT Setup Wizard — Prerequisiti e Health Check
 *
 * Step 1: verifica Node >= 18, npm disponibile.
 * Step finale: test API key con chiamata Anthropic/OpenAI.
 */
import { execSync } from 'node:child_process';
import { resolveSecret } from './secret-ref.js';

const MIN_NODE_VERSION = 18;

/**
 * Verifica prerequisiti di sistema.
 * @param {import('./prompts.js').WizardPrompter} prompter
 * @returns {Promise<boolean>} true se OK
 */
export async function checkPrerequisites(prompter) {
  const progress = prompter.progress('Verifica prerequisiti...');
  const issues = [];

  // Node version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major < MIN_NODE_VERSION) {
    issues.push(`Node.js ${nodeVersion} — richiesto >= ${MIN_NODE_VERSION}`);
  }

  // npm disponibile
  try {
    execSync('npm --version', { encoding: 'utf-8', timeout: 5000 });
  } catch {
    issues.push('npm non trovato nel PATH');
  }

  if (issues.length > 0) {
    progress.stop('Problemi trovati');
    await prompter.note(issues.join('\n'), 'Prerequisiti mancanti');
    const cont = await prompter.confirm({
      message: 'Continuare comunque?',
      initialValue: false,
    });
    return cont;
  }

  progress.stop(`Node ${nodeVersion}, npm OK`);
  return true;
}

/**
 * Testa la API key con una chiamata minimale.
 * @param {import('./prompts.js').WizardPrompter} prompter
 * @param {object} provider — provider da AI_PROVIDERS
 * @param {object|string} apiKeySecret — SecretInput o stringa
 * @returns {Promise<boolean>}
 */
export async function runHealthCheck(prompter, provider, apiKeySecret) {
  const progress = prompter.progress('Verifica API key...');
  const key = typeof apiKeySecret === 'string' ? apiKeySecret : resolveSecret(apiKeySecret);

  if (!key) {
    progress.stop('API key vuota — skip health check');
    return false;
  }

  try {
    if (provider.value === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok || res.status === 200) {
        progress.stop('API key valida — connessione OK');
        return true;
      }
      const body = await res.text().catch(() => '');
      progress.stop(`API errore ${res.status}: ${body.slice(0, 80)}`);
      return false;
    }

    if (provider.value === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        progress.stop('API key valida — connessione OK');
        return true;
      }
      progress.stop(`API errore ${res.status}`);
      return false;
    }

    // Provider senza health check
    progress.stop('Health check non disponibile per questo provider');
    return true;
  } catch (err) {
    progress.stop(`Errore connessione: ${err.message?.slice(0, 60) ?? 'timeout'}`);
    return false;
  }
}
