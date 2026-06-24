// cloud-direct.js
//
// Factory condivisa del client Supabase-diretto per i loop del daemon
// ([JHT-DAEMON-SUPABASE-DIRECT] Fase 1). Centralizza qui (invece che in cloud.js)
// così sia il cloud daemon sia il team-state-reconciler usano la STESSA istanza
// (singleton di modulo) → un solo access_token in cache, 1 refresh ~ogni ora e
// non per-loop.
//
// Opt-in via env JHT_SUPABASE_DIRECT=1 (default OFF → nessun cambio sul fleet
// finché non si abilita su una VPS). Credenziali da cloud.json (supabase_url +
// supabase_refresh_token, dal pairing/login Google) + anon key pubblica da env
// JHT_SUPABASE_ANON_KEY o cloud.json.supabase_anon_key. La RLS limita ai dati
// dell'utente. Vedi docs/internal/2026-06-24-vps-daemon-supabase-direct-design.md.

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { createSupabaseDirect } from './supabase-direct.js';

const CLOUD_FILE = join(JHT_HOME, 'cloud.json');

export function directReadsEnabled() {
  return process.env.JHT_SUPABASE_DIRECT === '1';
}

let _reader = null;
let _readerKey = null;

/**
 * Ritorna il client Supabase-diretto per `config` (cloud.json già caricato), o
 * null se disabilitato o senza credenziali → il caller fa fallback a Vercel.
 */
export function getDirectReader(config) {
  if (!directReadsEnabled()) return null;
  const supabaseUrl = config?.supabase_url;
  const refreshToken = config?.supabase_refresh_token;
  const anonKey = process.env.JHT_SUPABASE_ANON_KEY || config?.supabase_anon_key;
  if (!supabaseUrl || !refreshToken || !anonKey) return null;

  // Riusa l'istanza tra i tick/moduli: mantiene l'access_token in cache. La
  // chiave esclude il refresh_token (ruota a ogni uso).
  const key = `${supabaseUrl}|${anonKey}|${config.user_id || ''}`;
  if (_reader && _readerKey === key) return _reader;

  _reader = createSupabaseDirect({
    supabaseUrl,
    anonKey,
    refreshToken,
    userId: config.user_id,
    // GoTrue ruota il refresh_token → persistilo su cloud.json (best-effort).
    onRefreshToken: async (newToken) => {
      try {
        const c = JSON.parse(await readFile(CLOUD_FILE, 'utf-8'));
        c.supabase_refresh_token = newToken;
        await mkdir(JHT_HOME, { recursive: true });
        await writeFile(CLOUD_FILE, JSON.stringify(c, null, 2) + '\n');
        await chmod(CLOUD_FILE, 0o600);
      } catch { /* best-effort: al prossimo refresh riprova */ }
    },
    log: (level, msg) => console.error(`  supabase-direct ${level}: ${msg}`),
  });
  _readerKey = key;
  return _reader;
}
