import type { NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { updateSession } from '@/lib/supabase/middleware';
import { isClerkConfigured } from '@/lib/clerk';

/**
 * Un seul middleware pour deux fournisseurs.
 *
 * Avec Clerk, c'est `clerkMiddleware` qui doit s'exécuter : sans lui, `auth()`
 * lève une erreur dans les Server Components. Sans Clerk, on garde le
 * rafraîchissement de session Supabase, qui existait déjà.
 *
 * On ne protège aucune route ici. La redirection vers `/connexion` reste le
 * fait de `requireUser()`, et l'accès aux données celui de la RLS — un
 * middleware qui filtre les URL donne l'illusion de la sécurité sans en
 * fournir : il ne voit pas les requêtes que le navigateur adresse
 * directement à Supabase.
 */
const withClerk = clerkMiddleware();

export default function middleware(request: NextRequest, event: never) {
  if (isClerkConfigured()) {
    return withClerk(request, event);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Toutes les routes sauf les fichiers statiques, les images, le manifeste
     * et le service worker — qui doivent rester servis sans redirection.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    // Chemin par lequel Clerk fait transiter ses appels quand il est actif.
    '/__clerk/:path*',
  ],
};
