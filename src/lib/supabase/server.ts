import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createTokenClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import type { Database } from '@/lib/database.types';
import { isClerkConfigured } from '@/lib/clerk';

/**
 * Client Supabase côté serveur.
 *
 * Deux façons de prouver qui l'on est, et deux clients différents — ce n'est
 * pas un détail, les deux s'excluent :
 *
 * - **Clerk** : le jeton de session Clerk est passé par l'option
 *   `accessToken`, et Supabase le vérifie avec la clé publique de l'instance
 *   (Third-Party Auth). Il faut ici le client simple de `supabase-js`.
 *   `createServerClient` de `@supabase/ssr` ne convient PAS : il s'abonne en
 *   interne à `onAuthStateChange` pour tenir les cookies à jour, or
 *   `accessToken` interdit tout accès à `supabase.auth`. Les combiner lève
 *   « Supabase Client is configured with the accessToken option ».
 *
 * - **Supabase Auth** : la session vit dans les cookies, et c'est exactement
 *   ce que `createServerClient` sait faire.
 *
 * Dans les deux cas la RLS s'applique de la même manière, puisque les
 * politiques lisent `auth.jwt() ->> 'sub'` et non un identifiant maison.
 */
export async function createClient() {
  if (isClerkConfigured()) {
    return createTokenClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // Supabase réclame le jeton à chaque requête plutôt qu'une fois pour
        // toutes : Clerk fait tourner ses jetons, un jeton capturé au montage
        // serait périmé avant la fin du rendu.
        accessToken: async () => (await auth()).getToken(),
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }

  const cookieStore = await cookies();

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
