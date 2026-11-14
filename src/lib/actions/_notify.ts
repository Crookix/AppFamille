import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * Prévient les autres adultes du foyer qu'on vient d'ajouter quelque chose.
 *
 * Passe par la fonction SQL `notify_household` (migration 0022), qui contrôle
 * l'appartenance, écarte l'auteur et ceux qui ont coupé ce réglage, et regroupe
 * les ajouts rapprochés en une seule notification. Le tri par réglage ne peut
 * pas se faire ici : la RLS ne laisse lire que ses propres préférences.
 *
 * Un échec ne remonte jamais : la notification est un confort, l'ajout lui-même
 * a déjà réussi. On ne journalise que le code d'erreur, rien du contenu.
 *
 * `bodyMany` contient `{n}`, remplacé par le nombre d'ajouts regroupés.
 */
export async function notifyAddition(
  client: SupabaseClient<Database>,
  input: {
    householdId: string;
    kind: 'reco_ajoutee' | 'liste_ajout';
    title: string;
    body: string;
    bodyMany: string;
    link: string;
    count?: number;
  },
) {
  try {
    const { error } = await client.rpc('notify_household', {
      p_household_id: input.householdId,
      p_kind: input.kind,
      p_title: input.title,
      p_body: input.body,
      p_body_many: input.bodyMany,
      p_link: input.link,
      p_count: input.count ?? 1,
    });
    if (error) console.error('notify_household a échoué', error.code);
  } catch {
    console.error('notify_household a échoué');
  }
}
