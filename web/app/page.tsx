import JsonLd from './components/landing/JsonLd'
import LandingClient from './components/landing/LandingClient'

type SearchParams = Promise<{ login?: string; error?: string }>

export default async function LandingPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const sp = await searchParams
  const wantsLogin = sp.login === 'true'
  const authError = sp.error === 'auth_failed'

  return (
    <>
      <JsonLd />
      <LandingClient wantsLogin={wantsLogin} authError={authError} />
    </>
  )
}
