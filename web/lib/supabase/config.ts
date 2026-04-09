export type SupabaseConfig =
  | { configured: true; url: string; anonKey: string }
  | { configured: false; reason: 'missing' | 'invalid-url' | 'missing-anon-key' }

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function getSupabaseConfig(): SupabaseConfig {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''

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
