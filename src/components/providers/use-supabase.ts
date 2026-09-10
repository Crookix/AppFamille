'use client';

import * as React from 'react';
import { useAuth } from '@clerk/nextjs';
import { createClient, createClientWithToken } from '@/lib/supabase/client';

/**
 * Le client Supabase du navigateur, muni du bon jeton.
 *
 * Sans Clerk, la session vit dans les cookies et le client habituel suffit.
 * Avec Clerk, elle vit dans le jeton Clerk : il faut le fournir à Supabase,
 * sinon les requêtes partent en anonyme. Ce serait silencieux et sournois —
 * la RLS ne renverrait rien, et l'écran s'afficherait simplement vide au lieu
 * de signaler une erreur.
 *
 * On fabrique un client par valeur de `getToken` plutôt qu'un singleton : le
 * jeton doit rester lié à la session en cours, y compris après une
 * déconnexion suivie d'une reconnexion sous un autre compte.
 */
export function useSupabase() {
  const clerkActive = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  // `useAuth` doit être appelé sans condition — c'est la règle des hooks.
  // Hors ClerkProvider il renvoie un objet inerte, ce qui convient : on ne
  // s'en sert que si Clerk est configuré.
  const clerk = useAuth();

  return React.useMemo(() => {
    if (!clerkActive) return createClient();
    return createClientWithToken(() => clerk.getToken());
    // `clerk.getToken` change d'identité à chaque rendu ; on se raccroche à
    // l'identifiant de session, qui, lui, ne bouge qu'à la connexion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkActive, clerk.sessionId]);
}

/** Déconnexion, quel que soit le fournisseur. */
export function useSignOut() {
  const clerkActive = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const clerk = useAuth();
  const supabase = useSupabase();

  return React.useCallback(async () => {
    if (clerkActive) {
      await clerk.signOut();
      return;
    }
    await supabase.auth.signOut();
  }, [clerkActive, clerk, supabase]);
}
