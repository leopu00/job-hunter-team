/**
 * Login subscription via OAuth — PKCE flow con localhost callback.
 *
 * Flusso: genera PKCE + state → apri browser → ascolta callback
 * su localhost → ricevi authorization code → scambia per token.
 * Supporta fallback manuale per ambienti senza browser.
 */

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { URL } from 'node:url';
import { openInBrowser, isRemoteEnvironment } from './browser-open.js';

const CALLBACK_PORT = 3737;
const CALLBACK_PATH = '/callback';
const CALLBACK_TIMEOUT_MS = 120_000; // 2 minuti

/**
 * Genera verifier e challenge PKCE (S256).
 * @returns {{ verifier: string, challenge: string }}
 */
export function generatePKCE() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Genera un token state random per protezione CSRF.
 * @returns {string}
 */
export function generateState() {
  return randomBytes(16).toString('hex');
}

/**
 * Costruisce URL di autorizzazione OAuth.
 * @param {object} params
 * @param {string} params.authorizeUrl - endpoint authorize del provider
 * @param {string} params.clientId
 * @param {string} params.challenge - PKCE challenge
 * @param {string} params.state
 * @param {string[]} [params.scopes]
 * @returns {string}
 */
export function buildAuthorizeUrl({ authorizeUrl, clientId, challenge, state, scopes }) {
  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (scopes?.length) url.searchParams.set('scope', scopes.join(' '));
  return url.toString();
}

/**
 * Avvia un server HTTP temporaneo per ricevere il callback OAuth.
 * @param {string} expectedState - state atteso per validazione CSRF
 * @returns {Promise<{ code: string, state: string }>}
 */
export function waitForCallback(expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400).end(pageHtml('Errore', `Autenticazione fallita: ${error}`));
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || state !== expectedState) {
        res.writeHead(400).end(pageHtml('Errore', 'Parametri callback non validi.'));
        server.close();
        reject(new Error('Invalid callback: code mancante o state non corrispondente'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(pageHtml('Login completato', 'Puoi chiudere questa finestra e tornare al terminale.'));
      server.close();
      resolve({ code, state });
    });

    server.listen(CALLBACK_PORT, '127.0.0.1');

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Timeout: nessun callback ricevuto entro 2 minuti'));
    }, CALLBACK_TIMEOUT_MS);

    server.on('close', () => clearTimeout(timeout));
  });
}

/**
 * Esegue il login subscription completo.
 *
 * @param {object} params
 * @param {string} params.authorizeUrl - URL authorize del provider
 * @param {string} params.clientId - client ID OAuth
 * @param {string[]} [params.scopes]
 * @param {import('../../wizard/prompts.js').WizardPrompter} [params.prompter] - per fallback manuale
 * @returns {Promise<{ code: string, verifier: string, state: string } | null>}
 */
export async function startSubscriptionLogin({ authorizeUrl, clientId, scopes, prompter }) {
  const { verifier, challenge } = generatePKCE();
  const state = generateState();

  const url = buildAuthorizeUrl({ authorizeUrl, clientId, challenge, state, scopes });

  const remote = isRemoteEnvironment();

  if (remote && prompter) {
    // Fallback manuale: mostra URL, chiedi il codice
    await prompter.note(
      `Apri questo URL nel tuo browser:\n\n${url}\n\nDopo il login, incolla l'URL di redirect qui sotto.`,
      'Login manuale',
    );
    const redirectUrl = await prompter.text({
      message: 'URL di redirect (incolla dalla barra del browser)',
      placeholder: 'http://127.0.0.1:3737/callback?code=...&state=...',
    });
    return parseRedirectUrl(redirectUrl, state, verifier);
  }

  // Browser locale: apri e ascolta callback
  const { ok } = openInBrowser(url);
  if (!ok && prompter) {
    await prompter.note(
      `Non riesco ad aprire il browser. Apri manualmente:\n\n${url}`,
      'Browser non disponibile',
    );
  }

  try {
    const { code } = await waitForCallback(state);
    return { code, verifier, state };
  } catch (err) {
    if (prompter) {
      await prompter.note(`Callback fallito: ${err.message}`, 'Errore');
    }
    return null;
  }
}

/**
 * Parsa un URL di redirect incollato manualmente.
 */
function parseRedirectUrl(input, expectedState, verifier) {
  try {
    const url = new URL(input.trim());
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) return null;
    if (state && state !== expectedState) return null;
    return { code, verifier, state: state || expectedState };
  } catch {
    return null;
  }
}

function pageHtml(title, message) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>JHT — ${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f0f0}
.box{background:white;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);text-align:center}</style></head>
<body><div class="box"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}
