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
import dynamic from 'next/dynamic'

const GlobalSearch = dynamic(() => import('./components/GlobalSearch').then(m => m.GlobalSearch))
const FloatingChat = dynamic(() => import('./components/FloatingChat'))

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
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#060608' },
    { media: '(prefers-color-scheme: light)', color: '#f0f0f7' },
  ],
  colorScheme: 'dark light',
}

export const metadata: Metadata = {
  title: {
    default: 'Job Hunter Team',
    template: '%s | Job Hunter Team',
  },
  description: 'A team of AI agents that find jobs for you. Open source, local, private.',
  keywords: ['job hunting', 'AI agents', 'job search', 'automatic applications', 'open source'],
  authors: [{ name: 'Job Hunter Team' }],
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Job Hunter Team',
    title: 'Job Hunter Team',
    description: 'A team of AI agents that find jobs for you. Open source, local, private.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Job Hunter Team',
    description: 'A team of AI agents that find jobs for you. Open source, local, private.',
  },
  alternates: {
    canonical: '/',
    languages: { 'en-US': '/', 'it-IT': '/' },
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'),
  robots: { index: true, follow: true },
  manifest: '/manifest.json',
  other: {
    'theme-color': '#00e87a',
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
    <html lang="en" className={jetbrainsMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('jht-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);else if(t==='system'||!t){var d=window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',d)}}catch(e){}})()` }} />
      </head>
      <body>
        <noscript>
          <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'monospace', background: '#060608', color: '#e0e0f0', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p>Job Hunter Team requires JavaScript to run. Please enable it in your browser to continue.</p>
          </div>
        </noscript>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded focus:text-sm focus:font-semibold" style={{ background: 'var(--color-green)', color: 'var(--color-void)' }}>
          Skip to main content
        </a>
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
