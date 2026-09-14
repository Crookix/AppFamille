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
 * POURQUOI DEUX IMPLÉMENTATIONS, CHOISIES ICI ET NON DANS LE RENDU
 * ----------------------------------------------------------------
 * `useAuth()` ne tolère pas l'absence de `ClerkProvider` : hors de lui, il
 * **lève** `useAssertWrappedByClerkProvider`. Or ne pas monter `ClerkProvider`
 * est l'état normal quand Clerk n'est pas configuré (voir `AuthProvider`).
 * L'appeler « sans condition, par respect de la règle des hooks » faisait donc
 * planter tout écran qui touche à Supabase — accueil, calendrier, listes,
 * repas, reco — dès que Clerk était absent.
 *
 * La règle des hooks exige un ordre d'appel **stable d'un rendu à l'autre**,
 * pas un appel inconditionnel dans le fichier. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
 * est remplacée à la compilation : sa valeur ne peut pas changer en cours
 * d'exécution. Choisir la variante une fois, au chargement du module, donne
 * donc un ordre parfaitement stable — et n'appelle `useAuth()` que là où un
 * `ClerkProvider` existe.
 */
const clerkActif = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * Variante Clerk : un client par session.
 *
 * On fabrique un client par valeur de `getToken` plutôt qu'un singleton : le
 * jeton doit rester lié à la session en cours, y compris après une
 * déconnexion suivie d'une reconnexion sous un autre compte.
 */
function useSupabaseAvecClerk() {
  const clerk = useAuth();

  return React.useMemo(
    () => createClientWithToken(() => clerk.getToken()),
    // `clerk.getToken` change d'identité à chaque rendu ; on se raccroche à
    // l'identifiant de session, qui, lui, ne bouge qu'à la connexion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clerk.sessionId],
  );
}

/** Variante cookies : la session Supabase suffit, Clerk n'est pas monté. */
function useSupabaseAvecCookies() {
  return React.useMemo(() => createClient(), []);
}

export const useSupabase = clerkActif ? useSupabaseAvecClerk : useSupabaseAvecCookies;

/* -------------------------------------------------------------------------- */
/* Déconnexion                                                                */
/* -------------------------------------------------------------------------- */

function useSignOutAvecClerk() {
  const clerk = useAuth();
  return React.useCallback(async () => {
    await clerk.signOut();
  }, [clerk]);
}

function useSignOutAvecCookies() {
  const supabase = useSupabaseAvecCookies();
  return React.useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);
}

/** Déconnexion, quel que soit le fournisseur. */
export const useSignOut = clerkActif ? useSignOutAvecClerk : useSignOutAvecCookies;
