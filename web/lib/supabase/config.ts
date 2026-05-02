export type SupabaseConfig =
  | { configured: true; url: string; anonKey: string }
  | { configured: false; reason: 'missing' | 'invalid-url' | 'missing-anon-key' }

// Public Supabase project — anon key is safe to ship in client code.
// Security is enforced by RLS policies (see supabase/migrations/001_schema.sql),
// not by hiding this key. Vercel env vars override these defaults in production.
const DEFAULT_URL = 'https://smittwvohsnwwwisqdrh.supabase.co'
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtaXR0d3ZvaHNud3d3aXNxZHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMDIzMDgsImV4cCI6MjA4OTY3ODMwOH0.g7twGaXdmmqBtukaioaJ1OV2mXVJqpEhkyzXaEIH44I'

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function getSupabaseConfig(): SupabaseConfig {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const envKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''

  const rawUrl = envUrl || DEFAULT_URL
  const anonKey = envKey || DEFAULT_ANON_KEY

  if (!rawUrl) return { configured: false, reason: 'missing' }
  if (!anonKey) return { configured: false, reason: 'missing-anon-key' }
  if (!isValidHttpUrl(rawUrl)) return { configured: false, reason: 'invalid-url' }

  return {
    configured: true,
    url: rawUrl,
    anonKey,
  }
}

export function hasSupabaseConfig(): boolean {
  return getSupabaseConfig().configured
}
