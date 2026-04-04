import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Sidebar from './components/sidebar'
import MainContent from './components/main-content'
import { ThemeProvider } from './theme-provider'
import Breadcrumb from './components/Breadcrumb'
import { ToastProvider } from './components/Toast'
import { KeyboardShortcutsProvider } from './components/KeyboardShortcuts'
import { AccessibilityProvider } from './components/AccessibilityProvider'
import { GlobalSearch } from './components/GlobalSearch'
import FloatingChat from './components/FloatingChat'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Job Hunter Team',
    template: '%s | Job Hunter Team',
  },
  description: 'Un team di agenti AI che cercano lavoro per te. Open source, locale, privato.',
  keywords: ['job hunting', 'AI agents', 'job search', 'candidature automatiche', 'open source'],
  authors: [{ name: 'Job Hunter Team' }],
  openGraph: {
    type: 'website',
    locale: 'it_IT',
    siteName: 'Job Hunter Team',
    title: 'Job Hunter Team',
    description: 'Un team di agenti AI che cercano lavoro per te. Open source, locale, privato.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Job Hunter Team' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Job Hunter Team',
    description: 'Un team di agenti AI che cercano lavoro per te. Open source, locale, privato.',
    images: ['/og-image.png'],
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.com'),
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="it" className={jetbrainsMono.variable}>
      <body>
        <ThemeProvider>
          <AccessibilityProvider>
          <ToastProvider>
            <KeyboardShortcutsProvider>
              <GlobalSearch />
              <FloatingChat />
              <Sidebar />
              <MainContent>
                <Breadcrumb />
                {children}
              </MainContent>
            </KeyboardShortcutsProvider>
          </ToastProvider>
          </AccessibilityProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
