import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { HouseholdMemberRow, HouseholdRow } from '@/lib/database.types';

export const ACTIVE_HOUSEHOLD_COOKIE = 'tribu_foyer';

/** L'application est-elle reliée à un projet Supabase ? */
export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Utilisateur connecté, ou `null`.
 *
 * `cache()` déduplique l'appel sur toute la durée d'un rendu : une page qui
 * interroge l'utilisateur depuis trois composants ne fait qu'un aller-retour.
 */
export const getUser = cache(async () => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/connexion');
  return user;
}

export type ActiveHousehold = {
  household: HouseholdRow;
  member: HouseholdMemberRow;
  memberships: { household: HouseholdRow; member: HouseholdMemberRow }[];
};

/**
 * Foyer actif de l'utilisateur.
 *
 * Un adulte appartient presque toujours à un seul foyer, mais le modèle ne
 * l'impose pas (famille recomposée, second logement). Le foyer courant est
 * mémorisé dans un cookie ; à défaut, on prend le plus ancien.
 */
export const getActiveHousehold = cache(async (): Promise<ActiveHousehold | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('*, household:households(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error || !data || data.length === 0) return null;

  const memberships = data
    .filter((row): row is typeof row & { household: HouseholdRow } => Boolean(row.household))
    .map((row) => {
      const { household, ...member } = row;
      return { household, member: member as HouseholdMemberRow };
    });

  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_HOUSEHOLD_COOKIE)?.value;
  const active =
    memberships.find((m) => m.household.id === preferred) ?? memberships[0];

  return { household: active.household, member: active.member, memberships };
});

/**
 * Foyer actif, ou redirection vers le parcours de création.
 * À utiliser dans toutes les pages de l'application.
 */
export async function requireHousehold(): Promise<ActiveHousehold> {
  await requireUser();
  const active = await getActiveHousehold();
  if (!active) redirect('/bienvenue');
  return active;
}
