'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import type { Database as Db } from '@/lib/database.types';

/**
 * Client Supabase du navigateur.
 *
 * Un singleton : plusieurs instances ouvriraient plusieurs connexions temps
 * réel et se disputeraient le rafraîchissement du jeton.
 *
 * Quand Clerk est configuré, le jeton ne vient plus des cookies Supabase mais
 * de la session Clerk. Les composants qui écoutent le temps réel passent donc
 * par `useSupabase()` (voir `use-supabase.ts`), qui fournit le bon jeton.
 */
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Db>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}

/**
 * Client du navigateur adossé à un jeton fourni de l'extérieur.
 *
 * Sert lorsque Clerk tient la session : `getToken` est la fonction que Clerk
 * expose côté client, et Supabase l'appelle à chaque requête.
 */
export function createClientWithToken(getToken: () => Promise<string | null>) {
  return createBrowserClient<Db>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: getToken },
  );
}
