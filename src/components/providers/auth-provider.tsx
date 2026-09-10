'use client';

import * as React from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { frFR } from '@clerk/localizations';
import { clerkAppearanceClair, clerkAppearanceSombre } from '@/lib/clerk-appearance';

/**
 * Enveloppe d'authentification.
 *
 * Quand Clerk n'est pas configuré, ce composant ne fait rien : il rend ses
 * enfants tels quels. Monter `ClerkProvider` sans clé publiable ferait planter
 * l'application entière au premier rendu — or l'absence de Clerk est un état
 * parfaitement normal ici, pas une panne.
 *
 * `frFR` est indispensable : sans lui, les écrans de Clerk s'afficheraient en
 * anglais au milieu d'une application entièrement française.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const sombre = useThemeSombre();

  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      localization={frFR}
      appearance={sombre ? clerkAppearanceSombre : clerkAppearanceClair}
      signInUrl="/connexion"
      signUpUrl="/connexion"
    >
      {children}
    </ClerkProvider>
  );
}

/**
 * Le thème courant, tel que l'application le décide.
 *
 * Trois sources, dans l'ordre : le choix explicite mémorisé sur
 * `<html data-theme>`, puis la préférence du système. On observe l'attribut
 * plutôt que de lire `localStorage` une fois, pour suivre un basculement fait
 * depuis les réglages sans recharger la page.
 */
function useThemeSombre(): boolean {
  const [sombre, setSombre] = React.useState(false);

  React.useEffect(() => {
    const racine = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const relire = () => {
      const choisi = racine.getAttribute('data-theme');
      setSombre(choisi === 'dark' || (choisi === null && media.matches));
    };

    relire();
    const observateur = new MutationObserver(relire);
    observateur.observe(racine, { attributes: true, attributeFilter: ['data-theme'] });
    media.addEventListener('change', relire);

    return () => {
      observateur.disconnect();
      media.removeEventListener('change', relire);
    };
  }, []);

  return sombre;
}
