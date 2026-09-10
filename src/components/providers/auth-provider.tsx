'use client';

import * as React from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { frFR } from '@clerk/localizations';
import { shadcn } from '@clerk/ui/themes';

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
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      localization={frFR}
      appearance={{ theme: shadcn }}
      signInUrl="/connexion"
      signUpUrl="/connexion"
    >
      {children}
    </ClerkProvider>
  );
}
