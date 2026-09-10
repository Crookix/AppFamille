import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * Client à privilèges élevés (`service_role`), qui CONTOURNE la RLS.
 *
 * Réservé aux opérations que l'utilisateur ne peut pas faire lui-même :
 * synchronisation Google, chargement du foyer de démonstration, lecture des
 * jetons chiffrés. Chaque appel doit vérifier lui-même l'appartenance au
 * foyer — la base ne le fera pas à sa place.
 *
 * `server-only` garantit qu'un import accidentel depuis un composant client
 * casse la compilation au lieu de fuiter la clé.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY manquante : l'opération demandée nécessite un accès serveur.",
    );
  }

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
