import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { auth } from '@clerk/nextjs/server';
import type { Database } from '@/lib/database.types';
import { isClerkConfigured } from '@/lib/clerk';

/**
 * Client Supabase côté serveur.
 *
 * Deux façons de prouver qui l'on est, selon le fournisseur configuré :
 *
 * - **Clerk** : le jeton de session Clerk est passé à Supabase, qui le vérifie
 *   avec la clé publique de l'instance (Third-Party Auth). Aucun cookie
 *   Supabase n'entre en jeu.
 * - **Supabase Auth** : la session vit dans les cookies, comme avant.
 *
 * Dans les deux cas la RLS s'applique de la même manière, puisque les
 * politiques lisent `auth.jwt() ->> 'sub'` et non un identifiant maison.
 */
export async function createClient() {
  const cookieStore = await cookies();

  if (isClerkConfigured()) {
    return createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // Supabase réclame le jeton à chaque requête plutôt qu'une fois pour
        // toutes : Clerk fait tourner ses jetons toutes les minutes, un jeton
        // capturé au montage serait périmé avant la fin du rendu.
        accessToken: async () => (await auth()).getToken(),
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            // Clerk gère sa propre session : Supabase n'a aucun cookie à poser.
          },
        },
      },
    );
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Appelé depuis un Server Component : le rafraîchissement des
            // cookies est alors assuré par le middleware.
          }
        },
      },
    },
  );
}
