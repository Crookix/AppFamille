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
 * L'accord visuel avec Tribu est réglé une fois pour toutes sur le
 * `ClerkProvider`, via `appearance.variables`. Rien à surcharger ici : une
 * surcharge de classe qui ne correspond plus à la version installée est
 * ignorée en silence, et l'écran se dégrade sans prévenir. C'est exactement ce
 * qui s'est produit avec le thème shadcn, dont ce projet n'a pas les variables.
 */
export function ClerkSignIn({ redirectTo }: { redirectTo: string }) {
  return (
    <SignIn
      routing="hash"
      forceRedirectUrl={redirectTo}
      signUpForceRedirectUrl={redirectTo}
    />
  );
}
