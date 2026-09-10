'use client';

import { createBrowserClient } from '@supabase/ssr';
import { createClient as createTokenClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * Client Supabase du navigateur, adossé aux cookies de session Supabase.
 *
 * Un singleton : plusieurs instances ouvriraient plusieurs connexions temps
 * réel et se disputeraient le rafraîchissement du jeton.
 */
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}

/**
 * Client du navigateur adossé à un jeton fourni de l'extérieur (Clerk).
 *
 * Comme côté serveur, ce n'est PAS `createBrowserClient` : celui-ci gère les
 * cookies via `onAuthStateChange`, auquel l'option `accessToken` interdit
 * l'accès. Il faut le client simple de `supabase-js`.
 */
export function createClientWithToken(getToken: () => Promise<string | null>) {
  return createTokenClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: getToken,
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
