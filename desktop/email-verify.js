// Validazione delle credenziali della casella email DEDICATA del team, usata
// nell'onboarding (step obbligatorio). Round-trip completo:
//   1. login IMAP        → le credenziali sono giuste (lettura)
//   2. invio SMTP a sé   → la casella può ricevere posta
//   3. rilettura IMAP    → il team riesce davvero a LEGGERE ciò che arriva
// Il messaggio di verifica viene poi cancellato. Se uno qualsiasi degli step
// fallisce, l'utente non può procedere.
//
// Tutto gira nel main process Electron (il container non è ancora avviato a
// onboarding), via librerie pure-JS: imapflow (IMAP) + nodemailer (SMTP).

const { ImapFlow } = require('imapflow')
const nodemailer = require('nodemailer')
const crypto = require('node:crypto')

function domainOf(email) {
  return (String(email).split('@')[1] || '').toLowerCase()
}

// Host IMAP per i provider comuni; fallback imap.<dominio>:993 (SSL) così
// funziona anche con domini custom. Speculare a deriveImapHost in main.js.
function deriveImap(email) {
  const KNOWN = {
    'gmail.com': { host: 'imap.gmail.com', port: 993 },
    'googlemail.com': { host: 'imap.gmail.com', port: 993 },
    'outlook.com': { host: 'outlook.office365.com', port: 993 },
    'hotmail.com': { host: 'outlook.office365.com', port: 993 },
    'live.com': { host: 'outlook.office365.com', port: 993 },
    'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993 },
    'icloud.com': { host: 'imap.mail.me.com', port: 993 },
    'me.com': { host: 'imap.mail.me.com', port: 993 },
    // GMX (accetta la password normale, ottimo per test usa-e-getta)
    'gmx.com': { host: 'imap.gmx.com', port: 993 },
    'gmx.net': { host: 'imap.gmx.net', port: 993 },
    'gmx.de': { host: 'imap.gmx.net', port: 993 },
    // mail.com + suoi domini-alias comuni → server sempre imap.mail.com
    'mail.com': { host: 'imap.mail.com', port: 993 },
    'email.com': { host: 'imap.mail.com', port: 993 },
    'usa.com': { host: 'imap.mail.com', port: 993 },
    // Yandex (richiede una app-password)
    'yandex.com': { host: 'imap.yandex.com', port: 993 },
    'yandex.ru': { host: 'imap.yandex.ru', port: 993 },
  }
  const d = domainOf(email)
  return KNOWN[d] || { host: `imap.${d}`, port: 993 }
}

// Host SMTP per i provider comuni; fallback smtp.<dominio>:465 (SSL).
function deriveSmtp(email) {
  const KNOWN = {
    'gmail.com': { host: 'smtp.gmail.com', port: 465, secure: true },
    'googlemail.com': { host: 'smtp.gmail.com', port: 465, secure: true },
    'outlook.com': { host: 'smtp.office365.com', port: 587, secure: false },
    'hotmail.com': { host: 'smtp.office365.com', port: 587, secure: false },
    'live.com': { host: 'smtp.office365.com', port: 587, secure: false },
    'yahoo.com': { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    'icloud.com': { host: 'smtp.mail.me.com', port: 587, secure: false },
    'me.com': { host: 'smtp.mail.me.com', port: 587, secure: false },
    // GMX: SMTP è mail.gmx.* (NON smtp.gmx.*), porta 587 STARTTLS.
    'gmx.com': { host: 'mail.gmx.com', port: 587, secure: false },
    'gmx.net': { host: 'mail.gmx.net', port: 587, secure: false },
    'gmx.de': { host: 'mail.gmx.net', port: 587, secure: false },
    // mail.com + alias → server sempre smtp.mail.com, 587 STARTTLS.
    'mail.com': { host: 'smtp.mail.com', port: 587, secure: false },
    'email.com': { host: 'smtp.mail.com', port: 587, secure: false },
    'usa.com': { host: 'smtp.mail.com', port: 587, secure: false },
    // Yandex
    'yandex.com': { host: 'smtp.yandex.com', port: 465, secure: true },
    'yandex.ru': { host: 'smtp.yandex.ru', port: 465, secure: true },
  }
  const d = domainOf(email)
  return KNOWN[d] || { host: `smtp.${d}`, port: 465, secure: true }
}

// Domini personali comuni: usati SOLO per un avviso soft lato UI (non blocca),
// dato che una casella dedicata può comunque vivere su Gmail/Outlook.
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
])

function looksPersonal(email) {
  return PERSONAL_DOMAINS.has(domainOf(email))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanErr(e) {
  if (!e) return 'unknown'
  if (e.authenticationFailed) return 'auth-failed'
  const msg = e.responseText || e.message || String(e)
  return String(msg).slice(0, 240)
}

async function safeLogout(client) {
  if (!client) return
  try { await client.logout() } catch { /* ignore */ }
  try { client.close() } catch { /* ignore */ }
}

// Esegue il round-trip. Ritorna { ok, stage?, error?, imap_host?, imap_port? }.
// stage ∈ format | imap-login | smtp-send | imap-read — per messaggi mirati.
async function validateRoundTrip({ email, password } = {}, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {}
  const user = String(email || '').trim()
  // Le app-password Google si incollano coi gruppi separati da spazio.
  const pass = String(password || '').replace(/\s+/g, '')

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) {
    return { ok: false, stage: 'format', error: 'invalid-email' }
  }
  if (pass.length < 8) {
    return { ok: false, stage: 'format', error: 'invalid-password' }
  }

  const imap = deriveImap(user)
  const smtp = deriveSmtp(user)
  const code = crypto.randomBytes(4).toString('hex').toUpperCase()
  const marker = `JHT-VERIFY-${code}`

  // 1) IMAP login -----------------------------------------------------------
  let client = null
  try {
    log('imap-login')
    client = new ImapFlow({
      host: imap.host,
      port: imap.port,
      secure: true,
      auth: { user, pass },
      logger: false,
      emitLogs: false,
      connectionTimeout: 20000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    })
    await client.connect()
  } catch (e) {
    await safeLogout(client)
    return { ok: false, stage: 'imap-login', error: cleanErr(e) }
  }

  // 2) SMTP send (codice alla casella stessa) -------------------------------
  try {
    log('smtp-send')
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user, pass },
      connectionTimeout: 20000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    })
    await transport.sendMail({
      from: user,
      to: user,
      subject: marker,
      text:
        `Job Hunter Team — codice di verifica: ${code}\n\n` +
        'Questa email conferma che il team può ricevere e leggere la posta in ' +
        'questa casella. Puoi cancellarla: il team la rimuove da solo.',
    })
    try { transport.close() } catch { /* ignore */ }
  } catch (e) {
    await safeLogout(client)
    return { ok: false, stage: 'smtp-send', error: cleanErr(e) }
  }

  // 3) IMAP poll: cerca il marker in INBOX (fino a ~60s) --------------------
  try {
    log('imap-read')
    const deadline = Date.now() + 60000
    let foundUid = null
    while (Date.now() < deadline && foundUid == null) {
      const lock = await client.getMailboxLock('INBOX')
      try {
        // Re-seleziona INBOX a ogni giro così le nuove email sono visibili.
        const uids = await client.search({ subject: marker }, { uid: true })
        if (Array.isArray(uids) && uids.length) {
          foundUid = uids[uids.length - 1]
        }
      } finally {
        lock.release()
      }
      if (foundUid == null) await sleep(3000)
    }

    if (foundUid == null) {
      await safeLogout(client)
      return { ok: false, stage: 'imap-read', error: 'code-not-received' }
    }

    // Cleanup best-effort: rimuovi il messaggio di verifica.
    try {
      const lock = await client.getMailboxLock('INBOX')
      try { await client.messageDelete(foundUid, { uid: true }) } finally { lock.release() }
    } catch { /* lascia il messaggio se la delete fallisce */ }
  } catch (e) {
    await safeLogout(client)
    return { ok: false, stage: 'imap-read', error: cleanErr(e) }
  }

  await safeLogout(client)
  return { ok: true, imap_host: imap.host, imap_port: imap.port }
}

module.exports = {
  validateRoundTrip,
  deriveImap,
  deriveSmtp,
  looksPersonal,
  domainOf,
}
