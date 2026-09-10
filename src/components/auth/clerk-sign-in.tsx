'use client';

import { SignIn } from '@clerk/nextjs';

/**
 * Écran de connexion Clerk.
 *
 * On laisse Clerk fournir le formulaire complet plutôt que de le reconstruire :
 * il gère la vérification d'adresse, les mots de passe compromis, la limitation
 * des tentatives et l'authentification à deux facteurs. Réécrire tout cela à
 * la main pour gagner en cohérence visuelle serait un mauvais échange.
 *
 * L'apparence est alignée sur les jetons de Tribu : arrondis généreux, palette
 * terracotta, typographie du produit. L'écran doit avoir l'air d'appartenir à
 * l'application, pas d'être un formulaire emprunté.
 */
export function ClerkSignIn({ redirectTo }: { redirectTo: string }) {
  return (
    <SignIn
      routing="hash"
      forceRedirectUrl={redirectTo}
      signUpForceRedirectUrl={redirectTo}
      appearance={{
        elements: {
          rootBox: 'w-full',
          cardBox: 'w-full shadow-none',
          card: 'bg-[var(--bg-elevated)] border border-[var(--line)] rounded-[var(--radius-xl2)] shadow-sm',
          headerTitle: 'text-[var(--fg)] font-extrabold',
          headerSubtitle: 'text-[var(--fg-muted)]',
          socialButtonsBlockButton:
            'border-[var(--line)] rounded-full h-11 text-[var(--fg)]',
          formFieldInput:
            'rounded-2xl border-[var(--line)] bg-[var(--bg-elevated)] h-12 text-[16px]',
          formButtonPrimary:
            'bg-brand-500 hover:bg-brand-600 rounded-full h-11 text-[0.95rem] font-semibold normal-case shadow-sm',
          footerActionLink: 'text-brand-600 font-semibold',
        },
      }}
    />
  );
}
