import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseConfig } from '@/lib/supabase/config'

export function createClient() {
  const config = getSupabaseConfig()

  if (!config.configured) {
    return createMockBrowserClient() as any
  }

  return createBrowserClient(
    config.url,
    config.anonKey
  )
}

// Mock inline per evitare problemi di module resolution con Turbopack
function createMockBrowserClient(): any {
  const MOCK_ERROR = { message: 'Supabase not configured', code: 'NOT_CONFIGURED' }
  const MOCK_RESULT = { data: null, error: MOCK_ERROR }

  function mockChain(): any {
    const chain: any = {
      select: () => chain, insert: () => chain, update: () => chain, delete: () => chain,
      eq: () => chain, neq: () => chain, not: () => chain, or: () => chain,
      gte: () => chain, lte: () => chain, order: () => chain, limit: () => chain, range: () => chain,
      single: () => Promise.resolve(MOCK_RESULT),
      maybeSingle: () => Promise.resolve(MOCK_RESULT),
      then: (resolve: any, reject?: any) => Promise.resolve(MOCK_RESULT).then(resolve, reject),
    }
    return chain
  }

  return {
    from: () => mockChain(),
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      signInWithOAuth: () => Promise.resolve({ data: null, error: MOCK_ERROR }),
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }
}
