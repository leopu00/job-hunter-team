// Ephemeral loopback HTTP server that catches the OAuth callback
// from the user's default browser. Supabase redirects to
// http://127.0.0.1:<port>/auth/callback?code=...&state=...; we read
// the `code`, return a tiny success page, and shut the server down.
//
// Only one auth flow runs at a time, so we don't bother with a pool —
// each signIn() call spins a fresh server on a fresh random port.

const http = require('node:http')

const CALLBACK_PATH = '/auth/callback'

// HTML shown in the user's browser after the callback completes.
// Self-contained — no network deps so it works even if the device is
// momentarily offline post-OAuth.
const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Signed in — JHT Desktop</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0b1020; color: #e6e9f2; }
  .card { padding: 32px 40px; background: #131933; border-radius: 14px; max-width: 420px; text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,.45); }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0; opacity: .75; font-size: 14px; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>✓ Signed in</h1>
    <p>You can close this tab and return to JHT Desktop.</p>
  </div>
</body>
</html>`

const ERROR_HTML = (msg) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Sign-in failed</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1f0b0b;color:#fbe8e8;}
.card{padding:32px 40px;background:#3a1717;border-radius:14px;max-width:420px;text-align:center;}
h1{margin:0 0 8px;font-size:20px;} p{margin:0;opacity:.85;font-size:14px;}</style></head>
<body><div class="card"><h1>✗ Sign-in failed</h1><p>${escapeHtml(msg)}</p></div></body></html>`

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

// Start a server bound to 127.0.0.1 (NOT 0.0.0.0 — we don't want a
// LAN-reachable callback port) on an OS-assigned port. Resolves with
// { port, waitForCallback, close } once the listen succeeds.
function startCallbackServer({ timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let resolveCallback
    let rejectCallback
    const callbackPromise = new Promise((res, rej) => {
      resolveCallback = res
      rejectCallback = rej
    })

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        if (url.pathname !== CALLBACK_PATH) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error_description') || url.searchParams.get('error')
        if (error) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(ERROR_HTML(error))
          rejectCallback(new Error(error))
          return
        }
        if (!code) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(ERROR_HTML('Missing authorization code in callback'))
          rejectCallback(new Error('missing code'))
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(SUCCESS_HTML)
        resolveCallback({ code, state: url.searchParams.get('state') })
      } catch (err) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Internal error')
        rejectCallback(err)
      }
    })

    let timeoutHandle = null
    const close = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      try { server.close() } catch { /* ignore */ }
    }

    server.on('error', (err) => {
      close()
      reject(err)
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      if (!port) {
        close()
        reject(new Error('Failed to obtain callback port'))
        return
      }
      timeoutHandle = setTimeout(() => {
        rejectCallback(new Error('Sign-in timed out — no callback received'))
        close()
      }, timeoutMs)
      resolve({
        port,
        redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        waitForCallback: () => callbackPromise.finally(close),
        close,
      })
    })
  })
}

module.exports = { startCallbackServer, CALLBACK_PATH }
