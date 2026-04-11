import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase con service_role key per operazioni lato server che
 * devono bypassare RLS (es. verifica token CLI headless).
 * Usare SOLO in route API server-side, mai esposto al browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY mancante in env')
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
