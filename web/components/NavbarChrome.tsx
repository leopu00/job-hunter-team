'use client'

import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import Navbar from './Navbar'

// Routes where the whole app chrome (top nav + side nav) must disappear:
// the user is in a flow that MUST be completed before reaching the rest
// of the product (onboarding profile wizard). Side nav is already hidden
// via APP_CHROME_HIDDEN in sidebar.tsx / main-content.tsx.
const FULLSCREEN_FLOWS = ['/onboarding']

interface Props {
  user: User | null
}

export default function NavbarChrome(props: Props) {
  const pathname = usePathname() ?? ''
  const hidden = FULLSCREEN_FLOWS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  if (hidden) return null
  return <Navbar {...props} />
}
