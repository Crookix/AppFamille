import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ServiceWorker } from '@/components/pwa/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'MyFamily — l’organisation du foyer',
    template: '%s · MyFamily',
  },
  description:
    'Le calendrier, les tâches, les courses, les repas et les gardes de la famille, au même endroit.',
  manifest: '/manifest.webmanifest',
  applicationName: 'MyFamily',
  appleWebApp: {
    capable: true,
    title: 'MyFamily',
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
  themeColor: '#f2f2f7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" data-theme="light" suppressHydrationWarning>
      <head>
        {/*
          Applique le thème mémorisé AVANT le premier rendu (le clair, sans choix). Sans ce script,
          l'écran s'afficherait une fraction de seconde en clair avant de
          basculer en sombre.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('tribu-theme');if(t==='auto')document.documentElement.removeAttribute('data-theme');else if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}`,
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
