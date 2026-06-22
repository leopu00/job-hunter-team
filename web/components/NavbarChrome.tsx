'use client'

import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { type Locale } from '@/i18n/config'
import { isLocalDeploy } from '@/lib/deploy-mode'
import Navbar from './Navbar'

// Routes where the whole app chrome (top nav + side nav) must disappear:
// the user is in a flow that MUST be completed before reaching the rest
// of the product (onboarding profile wizard). Side nav is already hidden
// via APP_CHROME_HIDDEN in sidebar.tsx / main-content.tsx.
const FULLSCREEN_FLOWS = ['/onboarding']

interface Props {
  user: User | null
  locale: Locale
}

export default function NavbarChrome(props: Props) {
  const pathname = usePathname() ?? ''
  // [JHT-DASHBOARD-SPLIT] Sul container LOCAL la dashboard vive embedded
  // nell'app desktop, che ha già la propria sidebar/chrome: la navbar web
  // (logo + nav + login) è ridondante e dà la sensazione "pagina-in-pagina".
  // Su cloud (browser) resta.
  if (isLocalDeploy()) return null
  const hidden = FULLSCREEN_FLOWS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  if (hidden) return null
  return <Navbar {...props} />
}
