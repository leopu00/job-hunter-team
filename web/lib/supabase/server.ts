import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return createMockServerClient() as any
  }

  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — non può settare cookie, gestito dal middleware
          }
        },
      },
    }
  )
}

// Mock inline per funzionamento senza Supabase
function createMockServerClient(): any {
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
      exchangeCodeForSession: () => Promise.resolve({ data: { session: null }, error: MOCK_ERROR }),
    },
  }
}
