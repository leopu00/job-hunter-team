// Le decisioni dell'utente sulle esclusioni di profilo (cloud) → la tabella locale (JHT-T24).
//
// Il cloud tiene SOLO la decisione (codice + accettata/rifiutata, mig 094); la regola che agisce sul
// punteggio sta nella jobs.db del team e la scrive un solo script, `profile_exclusions.py reconcile`,
// che congela i parametri dalle colonne strutturali delle posizioni bocciate. Qui si fa solo il
// trasporto: leggere le righe, filtrarle a codice + stato, passarle allo script.

const STATUSES = new Set(['accepted', 'dismissed']);
const REASON = /^[a-z_]{1,32}$/;

let lastDigest = null;

/** Per i test: dimentica l'ultima sincronizzazione. */
export function resetProfileExclusionsSync() {
  lastDigest = null;
}

/**
 * @param {object} o
 * @param {{readProfileExclusions?: () => Promise<object[]>}|null} o.reader  lettore diretto Supabase (se c'è)
 * @param {() => Promise<object[]>} o.fetchRemote   ripiego: la rotta del sito
 * @param {(skill: string, args: string[], opts: {input: string}) => {code: number, stdout: string, stderr: string}} o.run
 * @param {(line: string) => void} [o.log]
 * @returns {Promise<{ok: boolean, skipped?: string, unusable?: string[]}>}
 */
export async function syncProfileExclusions({ reader, fetchRemote, run, log = () => {} }) {
  let rows;
  try {
    rows = reader && typeof reader.readProfileExclusions === 'function'
      ? await reader.readProfileExclusions()
      : await fetchRemote();
  } catch (err) {
    log(`  profile exclusions warn: ${err.message}`);
    return { ok: false, skipped: 'read_failed' };
  }
  const decisions = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.reason === 'string' && REASON.test(r.reason) && STATUSES.has(r.status))
    .map((r) => ({ reason: r.reason, status: r.status }))
    .sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  if (decisions.length === 0) return { ok: true, skipped: 'nothing_decided' };
  const input = JSON.stringify(decisions);
  if (input === lastDigest) return { ok: true, skipped: 'unchanged' };
  const done = run('profile_exclusions.py', ['reconcile'], { input });
  if (done.code !== 0) {
    log(`  profile exclusions warn: the team did not take the decisions (exit ${done.code})`);
    return { ok: false, skipped: 'script_failed' };
  }
  lastDigest = input;
  let unusable = [];
  try {
    const answer = JSON.parse(done.stdout);
    if (Array.isArray(answer.unusable)) unusable = answer.unusable.filter((c) => typeof c === 'string');
  } catch {
    // an answer nobody can read is still a done reconcile
  }
  if (unusable.length > 0) log(`  profile exclusions: no structured evidence yet for ${unusable.join(', ')}`);
  return { ok: true, unusable };
}
