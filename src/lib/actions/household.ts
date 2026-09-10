'use server';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ACTIVE_HOUSEHOLD_COOKIE, getUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fail, humanizeDbError, ok, requireActiveHousehold, requireMembership } from './_helpers';
import type { Database } from '@/lib/database.types';

/** Durée de validité d'un lien d'invitation. */
const INVITATION_DAYS = 7;

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Ce champ est obligatoire.')
  .max(80, 'Ce nom est trop long.');

/* -------------------------------------------------------------------------- */
/* Foyer                                                                      */
/* -------------------------------------------------------------------------- */

export async function createHouseholdAction(input: {
  name: string;
  displayName: string;
  timezone?: string;
}) {
  const parsed = z
    .object({
      name: nameSchema,
      displayName: nameSchema.max(60),
      timezone: z.string().trim().min(1).max(64).optional(),
    })
    .safeParse(input);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Formulaire incomplet.');
  }

  const user = await getUser();
  if (!user) return fail('Connexion requise.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_household', {
    p_name: parsed.data.name,
    p_display_name: parsed.data.displayName,
    p_timezone: parsed.data.timezone ?? 'Europe/Paris',
  });

  if (error || !data) return fail(humanizeDbError(error));

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, data, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
  return ok({ householdId: data as string });
}

export async function switchHouseholdAction(householdId: string) {
  const membership = await requireMembership(householdId);
  if (!membership.ok) return membership;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
  return ok();
}

export async function renameHouseholdAction(name: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { error } = await active.data.supabase
    .from('households')
    .update({ name: parsed.data })
    .eq('id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/', 'layout');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Membres                                                                    */
/* -------------------------------------------------------------------------- */

export async function updateMyMemberAction(input: {
  displayName?: string;
  color?: string;
}) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const patch: Database['public']['Tables']['household_members']['Update'] = {};

  if (input.displayName !== undefined) {
    const parsed = nameSchema.max(60).safeParse(input.displayName);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    patch.display_name = parsed.data;
  }
  if (input.color !== undefined) patch.color = input.color;

  if (Object.keys(patch).length === 0) return ok();

  const { error } = await active.data.supabase
    .from('household_members')
    .update(patch)
    .eq('id', active.data.member.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/', 'layout');
  return ok();
}

export async function setMemberRoleAction(memberId: string, role: 'admin' | 'adulte') {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  if (active.data.member.role !== 'admin') {
    return fail('Seul un administrateur du foyer peut changer un rôle.');
  }

  const { error } = await active.data.supabase
    .from('household_members')
    .update({ role })
    .eq('id', memberId)
    .eq('household_id', active.data.household.id);

  // Le trigger `guard_last_admin` refuse de laisser le foyer sans
  // administrateur : on rend ce refus lisible plutôt que brut.
  if (error) {
    return fail(
      error.message.includes('au moins un administrateur')
        ? 'Le foyer doit conserver au moins un administrateur.'
        : humanizeDbError(error),
    );
  }

  revalidatePath('/', 'layout');
  return ok();
}

export async function removeMemberAction(memberId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const isSelf = memberId === active.data.member.id;
  if (!isSelf && active.data.member.role !== 'admin') {
    return fail('Seul un administrateur du foyer peut retirer un membre.');
  }

  const { error } = await active.data.supabase
    .from('household_members')
    .delete()
    .eq('id', memberId)
    .eq('household_id', active.data.household.id);

  if (error) {
    return fail(
      error.message.includes('au moins un administrateur')
        ? "Vous êtes le seul administrateur : nommez d'abord quelqu'un d'autre."
        : humanizeDbError(error),
    );
  }

  if (isSelf) {
    const cookieStore = await cookies();
    cookieStore.delete(ACTIVE_HOUSEHOLD_COOKIE);
  }

  revalidatePath('/', 'layout');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                */
/* -------------------------------------------------------------------------- */

/** Condensat stocké en base : le jeton en clair ne vit que dans le lien. */
function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createInvitationAction(input: { email?: string | null }) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  if (active.data.member.role !== 'admin') {
    return fail('Seul un administrateur du foyer peut inviter quelqu’un.');
  }

  const email = input.email?.trim() || null;
  if (email) {
    const parsed = z.string().email("Cette adresse e-mail n'est pas valide.").safeParse(email);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
  }

  // 32 octets aléatoires : un lien ne peut pas être deviné.
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await active.data.supabase.from('invitations').insert({
    household_id: active.data.household.id,
    email,
    role: 'adulte',
    token_hash: hashToken(token),
    expires_at: expiresAt.toISOString(),
    created_by: active.data.member.user_id,
  });

  if (error) return fail(humanizeDbError(error));

  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

  revalidatePath('/plus/foyer');
  return ok({
    // Le jeton en clair n'est renvoyé qu'ici, une seule fois.
    link: `${base}/invitation/${token}`,
    expiresAt: expiresAt.toISOString(),
  });
}

export async function revokeInvitationAction(invitationId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  if (active.data.member.role !== 'admin') {
    return fail('Seul un administrateur du foyer peut annuler une invitation.');
  }

  const { error } = await active.data.supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('household_id', active.data.household.id)
    .is('accepted_at', null);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus/foyer');
  return ok();
}

/**
 * Accepte une invitation.
 *
 * Toute la vérification — jeton, expiration, révocation, réutilisation — a lieu
 * dans la fonction `accept_invitation` côté base, en une transaction : deux
 * ouvertures simultanées du même lien ne peuvent pas créer deux membres.
 */
export async function acceptInvitationAction(token: string) {
  const user = await getUser();
  if (!user) return fail('Connexion requise.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });

  if (error) return fail(error.message || "Cette invitation n'a pas pu être acceptée.");
  if (!data) return fail("Cette invitation n'a pas pu être acceptée.");

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, data, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
  return ok({ householdId: data as string });
}
