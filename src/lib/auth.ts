import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createClient } from '@/lib/supabase/server';
import { isClerkConfigured } from '@/lib/clerk';
import type { HouseholdMemberRow, HouseholdRow } from '@/lib/database.types';

/**
 * L'utilisateur connecté, indépendamment du fournisseur.
 *
 * Le reste de l'application ne doit pas savoir si l'identité vient de Clerk
 * ou de Supabase Auth. Elle ne manipule que cet objet — et surtout `id`, qui
 * est la valeur que la base retrouve dans `auth.jwt() ->> 'sub'`.
 */
export type AppUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

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
export const getUser = cache(async (): Promise<AppUser | null> => {
  if (!isSupabaseConfigured()) return null;

  if (isClerkConfigured()) {
    const { userId } = await auth();
    if (!userId) return null;

    // `currentUser()` interroge l'API Clerk ; `auth()` se contente de lire le
    // jeton. On ne paie l'aller-retour que si l'on a besoin du nom ou de
    // l'adresse, c'est-à-dire une fois par rendu grâce à `cache()`.
    const profile = await currentUser();
    const email = profile?.primaryEmailAddress?.emailAddress ?? null;
    const fullName =
      [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
      profile?.username ||
      null;

    return { id: userId, email, fullName, avatarUrl: profile?.imageUrl ?? null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? null,
    fullName:
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      null,
    avatarUrl: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
  };
});

/**
 * Garantit que le profil applicatif existe.
 *
 * Avec Supabase Auth, un déclencheur sur `auth.users` s'en chargeait. Un
 * utilisateur Clerk n'apparaît jamais dans `auth.users` : son profil doit donc
 * être créé à la volée, à la première visite. La fonction est idempotente et
 * ne réécrit jamais un prénom déjà choisi dans Tribu.
 */
export async function ensureProfile(user: AppUser): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc('ensure_profile', {
    p_email: user.email,
    p_full_name: user.fullName,
    p_avatar_url: user.avatarUrl,
    p_provider: isClerkConfigured() ? 'clerk' : 'supabase',
  });
}

export async function requireUser(): Promise<AppUser> {
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
