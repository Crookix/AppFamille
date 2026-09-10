import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ServiceWorker } from '@/components/pwa/service-worker';
import './globals.css';

const nunito = Nunito({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-nunito',
  weight: ['400', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: {
    default: 'Tribu — l’organisation du foyer',
    template: '%s · Tribu',
  },
  description:
    'Le calendrier, les tâches, les courses, les repas et les gardes de la famille, au même endroit.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Tribu',
  appleWebApp: {
    capable: true,
    title: 'Tribu',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  // `viewport-fit=cover` : l'application occupe l'écran jusque sous l'encoche,
  // les marges de sécurité étant reprises en CSS.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  // Le zoom reste autorisé : le bloquer nuit à l'accessibilité.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdf5ec' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1613' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={nunito.variable} suppressHydrationWarning>
      <head>
        {/*
          Applique le thème mémorisé AVANT le premier rendu. Sans ce script,
          l'écran s'afficherait une fraction de seconde en clair avant de
          basculer en sombre.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('tribu-theme');if(t&&t!=='auto')document.documentElement.setAttribute('data-theme',t)}catch(e){}`,
          }}
        />
      </head>
      <body>
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
        >
          Aller au contenu
        </a>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
