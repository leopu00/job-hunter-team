/**
 * JHT Setup Wizard — Prerequisiti e Health Check
 *
 * Step 1: verifica Node >= 18, npm disponibile.
 * Step finale: test API key con chiamata Anthropic/OpenAI.
 */
import { execSync } from 'node:child_process';
import { resolveSecret } from './secret-ref.js';
import { t, tf } from './i18n.js';

const MIN_NODE_VERSION = 18;

/**
 * Verifica prerequisiti di sistema.
 * @param {import('./prompts.js').WizardPrompter} prompter
 * @returns {Promise<boolean>} true se OK
 */
export async function checkPrerequisites(prompter) {
  const progress = prompter.progress(t('wizard.checks.prerequisites.checking'));
  const issues = [];

  // Node version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major < MIN_NODE_VERSION) {
    issues.push(tf('wizard.checks.prerequisites.node_required', nodeVersion, MIN_NODE_VERSION));
  }

  // npm disponibile
  try {
    execSync('npm --version', { encoding: 'utf-8', timeout: 5000 });
  } catch {
    issues.push(t('wizard.checks.prerequisites.npm_missing'));
  }

  if (issues.length > 0) {
    progress.stop(t('wizard.checks.prerequisites.problems_found'));
    await prompter.note(issues.join('\n'), t('wizard.checks.prerequisites.missing_title'));
    const cont = await prompter.confirm({
      message: t('wizard.checks.prerequisites.continue_anyway'),
      initialValue: false,
    });
    return cont;
  }

  progress.stop(tf('wizard.checks.prerequisites.ready', nodeVersion));
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
  const progress = prompter.progress(t('wizard.checks.health.checking'));
  const key = typeof apiKeySecret === 'string' ? apiKeySecret : resolveSecret(apiKeySecret);

  if (!key) {
    progress.stop(t('wizard.checks.health.empty_key'));
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
        progress.stop(t('wizard.checks.health.valid'));
        return true;
      }
      const body = await res.text().catch(() => '');
      progress.stop(tf('wizard.checks.health.api_error_body', res.status, body.slice(0, 80)));
      return false;
    }

    if (provider.value === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        progress.stop(t('wizard.checks.health.valid'));
        return true;
      }
      progress.stop(tf('wizard.checks.health.api_error', res.status));
      return false;
    }

    // Provider senza health check
    progress.stop(t('wizard.checks.health.unavailable'));
    return true;
  } catch (err) {
    progress.stop(tf('wizard.checks.health.connection_error', err.message?.slice(0, 60) ?? 'timeout'));
    return false;
  }
}
