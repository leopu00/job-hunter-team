import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Sidebar from './components/sidebar'
import MainContent from './components/main-content'
import { ThemeProvider } from './theme-provider'
import Breadcrumb from './components/Breadcrumb'
import { ToastProvider } from './components/Toast'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Job Hunter Team',
  description: 'Sistema automatizzato di ricerca e candidatura',
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
          <ToastProvider>
            <Sidebar />
            <MainContent>
              <Breadcrumb />
              {children}
            </MainContent>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
