import type { Metadata, Viewport } from 'next'
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#060608',
}

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
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Job Hunter Team',
    description: 'Un team di agenti AI che cercano lavoro per te. Open source, locale, privato.',
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'),
  manifest: '/manifest.json',
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'format-detection': 'telephone=no',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="it" className={jetbrainsMono.variable}>
      <body>
        <noscript>
          <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'monospace', background: '#060608', color: '#e0e0f0', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p>Job Hunter Team richiede JavaScript per funzionare. Abilitalo nel tuo browser per continuare.</p>
          </div>
        </noscript>
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
