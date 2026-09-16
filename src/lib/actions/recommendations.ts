'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Database } from '@/lib/database.types';
import { normalizeRecoUrl } from '@/lib/recommendations';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

const recoSchema = z.object({
  kind: z.enum(['film', 'serie', 'lecture', 'theatre', 'sortie', 'cadeau', 'autre']),
  title: z.string().trim().min(1, 'Le titre est obligatoire.').max(200),
  author: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  status: z.enum(['idee', 'en_cours', 'fait']).optional(),
  recipientLabel: z.string().trim().max(80).nullable().optional(),
  recipientChildId: z.string().uuid().nullable().optional(),
  occasion: z.string().trim().max(80).nullable().optional(),
  // La colonne est en numeric(10, 2) : au-delà, la base refuse la ligne.
  price: z.number().min(0).max(99_999_999).nullable().optional(),
});

export type RecommendationInput = z.input<typeof recoSchema>;

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Les champs propres au cadeau n'ont pas de sens ailleurs.
 *
 * Sans ce nettoyage, changer le genre d'une fiche laisserait derrière lui un
 * destinataire ou un prix invisibles à l'écran mais bien présents en base —
 * et qui ressurgiraient au prochain passage en « idée cadeau ».
 */
function giftFieldsFor(kind: string, values: {
  recipientLabel?: string | null;
  recipientChildId?: string | null;
  occasion?: string | null;
  price?: number | null;
}) {
  if (kind !== 'cadeau') {
    return {
      recipient_label: null,
      recipient_child_id: null,
      occasion: null,
      price: null,
    };
  }

  return {
    recipient_label: blankToNull(values.recipientLabel),
    recipient_child_id: values.recipientChildId ?? null,
    occasion: blankToNull(values.occasion),
    price: values.price ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Création et modification                                                   */
/* -------------------------------------------------------------------------- */

export async function createRecommendationAction(input: RecommendationInput) {
  const parsed = recoSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const reco = parsed.data;
  const { supabase, household, member } = active.data;

  const { data, error } = await supabase
    .from('recommendations')
    .insert({
      household_id: household.id,
      kind: reco.kind,
      status: reco.status ?? 'idee',
      title: reco.title,
      author: blankToNull(reco.author),
      note: blankToNull(reco.note),
      url: normalizeRecoUrl(reco.url),
      rating: reco.rating ?? null,
      ...giftFieldsFor(reco.kind, reco),
      suggested_by: member.id,
      created_by: member.user_id,
    })
    .select('id')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  revalidatePath('/reco');
  return ok({ id: data.id });
}

export async function updateRecommendationAction(
  recoId: string,
  input: Partial<RecommendationInput>,
) {
  const parsed = recoSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const reco = parsed.data;
  const { supabase, household, member } = active.data;

  const patch: Database['public']['Tables']['recommendations']['Update'] = {};
  if (reco.title !== undefined) patch.title = reco.title;
  if (reco.author !== undefined) patch.author = blankToNull(reco.author);
  if (reco.note !== undefined) patch.note = blankToNull(reco.note);
  if (reco.url !== undefined) patch.url = normalizeRecoUrl(reco.url);
  if (reco.rating !== undefined) patch.rating = reco.rating;
  if (reco.status !== undefined) {
    patch.status = reco.status;
    patch.done_by = reco.status === 'fait' ? member.id : null;
  }

  // Changer de genre redistribue les champs du cadeau : il faut donc le genre
  // d'arrivée, qui n'est pas toujours dans le formulaire envoyé.
  if (reco.kind !== undefined) {
    patch.kind = reco.kind;
    Object.assign(patch, giftFieldsFor(reco.kind, reco));
  } else if (
    reco.recipientLabel !== undefined ||
    reco.recipientChildId !== undefined ||
    reco.occasion !== undefined ||
    reco.price !== undefined
  ) {
    const { data: current } = await supabase
      .from('recommendations')
      .select('kind')
      .eq('id', recoId)
      .eq('household_id', household.id)
      .maybeSingle();

    if (!current) return fail("Cette recommandation n'existe plus.");
    Object.assign(patch, giftFieldsFor(current.kind, reco));
  }

  if (Object.keys(patch).length === 0) return ok();

  const { error } = await supabase
    .from('recommendations')
    .update(patch)
    .eq('id', recoId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/reco');
  return ok();
}

/**
 * Fait avancer une fiche d'un état à l'autre.
 *
 * Séparée de la modification complète parce que c'est le geste le plus
 * fréquent — « on l'a vu » — et qu'il doit tenir en un appui, sans ouvrir le
 * formulaire. `done_at` est posé par un déclencheur, pas ici.
 */
export async function setRecommendationStatusAction(
  recoId: string,
  status: 'idee' | 'en_cours' | 'fait',
) {
  const parsed = z.enum(['idee', 'en_cours', 'fait']).safeParse(status);
  if (!parsed.success) return fail('État inconnu.');

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household, member } = active.data;

  const { error } = await supabase
    .from('recommendations')
    .update({
      status: parsed.data,
      done_by: parsed.data === 'fait' ? member.id : null,
    })
    .eq('id', recoId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/reco');
  return ok();
}

export async function deleteRecommendationAction(recoId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('recommendations')
    .delete()
    .eq('id', recoId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/reco');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Envies                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ajoute ou retire l'envie de la personne connectée.
 *
 * Le contrôle d'appartenance de la recommandation n'est pas décoratif : la
 * clé étrangère garantit que la fiche existe, pas qu'elle appartient au foyer
 * courant. Sans cette lecture, une envie pourrait être rattachée à la fiche
 * d'un autre foyer sous notre propre `household_id` — la RLS n'y verrait rien
 * à redire, puisque la ligne insérée, elle, est bien la nôtre.
 */
export async function toggleRecommendationWantAction(recoId: string, want: boolean) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household, member } = active.data;

  const { data: reco } = await supabase
    .from('recommendations')
    .select('id')
    .eq('id', recoId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!reco) return fail("Cette recommandation n'existe plus.");

  if (!want) {
    const { error } = await supabase
      .from('recommendation_wants')
      .delete()
      .eq('recommendation_id', recoId)
      .eq('member_id', member.id);

    if (error) return fail(humanizeDbError(error));

    revalidatePath('/reco');
    return ok();
  }

  // Deux appuis rapprochés, ou deux onglets ouverts : l'unicité
  // (recommandation, membre) rend le second sans effet plutôt qu'en erreur.
  const { error } = await supabase
    .from('recommendation_wants')
    .upsert(
      {
        household_id: household.id,
        recommendation_id: recoId,
        member_id: member.id,
      },
      { onConflict: 'recommendation_id,member_id', ignoreDuplicates: true },
    );

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/reco');
  return ok();
}
