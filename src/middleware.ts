import { NextResponse, type NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { updateSession } from '@/lib/supabase/middleware';
import { isClerkConfigured } from '@/lib/clerk';
import { invitationCookieOptions, PENDING_INVITATION_COOKIE, tokenFromPath } from '@/lib/invitations';

/**
 * Un seul middleware pour deux fournisseurs, plus la mémoire des invitations.
 *
 * Avec Clerk, c'est `clerkMiddleware` qui doit s'exécuter : sans lui, `auth()`
 * lève une erreur dans les Server Components. Sans Clerk, on garde le
 * rafraîchissement de session Supabase, qui existait déjà.
 *
 * Ce que la sécurité doit à ce fichier : RIEN. L'accès aux données est le fait
 * de la RLS, et la redirection vers `/connexion` celui de `requireUser()`. Un
 * middleware qui filtre les URL donne l'illusion de la sécurité sans en
 * fournir : il ne voit pas les requêtes que le navigateur adresse directement
 * à Supabase.
 *
 * Il reste qu'il redirige, par confort de navigation : sans Clerk,
 * `updateSession` renvoie vers `/connexion` toute route hors `PUBLIC_PATHS`
 * (voir `supabase/middleware.ts`). Ce commentaire affirmait le contraire — « on
 * ne protège aucune route ici » — et la nuance coûte : on cherche ailleurs
 * pourquoi une page nouvelle est redirigée.
 *
 * En revanche, il est le seul endroit capable de poser un cookie sur le trajet
 * d'une page : un Server Component ne le peut pas. C'est donc ici qu'on retient
 * le jeton d'invitation, pour que l'écran de bienvenue puisse le reproposer si
 * la personne se perd en route en créant son compte.
 */
const withClerk = clerkMiddleware();

export default async function middleware(request: NextRequest, event: never) {
  const response = isClerkConfigured()
    ? ((await withClerk(request, event)) as NextResponse | undefined) ??
      NextResponse.next()
    : await updateSession(request);

  const token = tokenFromPath(request.nextUrl.pathname);
  if (token) {
    response.cookies.set(PENDING_INVITATION_COOKIE, token, invitationCookieOptions());
  }

  return response;
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
