import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import { ThemeProvider } from 'next-themes'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { THEME_IDS } from '@/lib/themes'
import { ThemeBackground } from '@/components/ui/theme-background'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

function resolveMetadataBase(): URL {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.MC_PUBLIC_BASE_URL,
    process.env.APP_URL,
    process.env.MISSION_CONTROL_PUBLIC_URL,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    try {
      return new URL(candidate)
    } catch {
      // Ignore invalid URL values and continue fallback chain.
    }
  }

  // Prevent localhost fallback in production metadata when env is unset.
  return new URL('https://clawstrap.local')
}

const metadataBase = resolveMetadataBase()

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Clawstrap — Multi-Agent Product Factory Dashboard',
  description: 'Multi-agent product factory dashboard. Manage agent fleets, dispatch tasks, track costs, and coordinate multi-agent workflows. Self-hosted, zero dependencies, SQLite-powered.',
  metadataBase,
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '256x256' },
      { url: '/brand/mc-logo-128.png', type: 'image/png', sizes: '128x128' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/icon.png'],
  },
  openGraph: {
    title: 'Clawstrap — Multi-Agent Product Factory Dashboard',
    description: 'Multi-agent product factory dashboard. Manage agent fleets, dispatch tasks, track costs, and coordinate multi-agent workflows.',
    images: [{ url: '/brand/mc-logo-512.png', width: 512, height: 512, alt: 'Clawstrap — multi-agent product factory dashboard' }],
    type: 'website',
    siteName: 'Clawstrap',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clawstrap — Multi-Agent Product Factory Dashboard',
    description: 'Multi-agent product factory dashboard. Manage agent fleets, dispatch tasks, track costs, and coordinate multi-agent workflows.',
    images: ['/brand/mc-logo-512.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Clawstrap',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const nonce = (await headers()).get('x-nonce') || undefined
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className="dark" suppressHydrationWarning>
      <head>
        {/* Blocking script to set 'dark' class before first paint, preventing FOUC.
            Content is a static string literal — no user input, no XSS vector. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'void';var light=['light','paper'];if(light.indexOf(t)===-1)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`} suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="void"
            themes={THEME_IDS}
            enableSystem={false}
            disableTransitionOnChange
          >
            <ThemeBackground />
            <div className="h-screen overflow-hidden bg-background text-foreground">
              {children}
            </div>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
