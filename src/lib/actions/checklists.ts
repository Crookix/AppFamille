'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Database } from '@/lib/database.types';
import { parseChecklistDraft } from '@/lib/checklists';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

const checklistSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom à cette check-list.').max(80),
  note: z.string().trim().max(500).nullable().optional(),
  /** Texte collé, découpé en points à la création. */
  draft: z.string().max(20_000).nullable().optional(),
});

export type ChecklistInput = z.input<typeof checklistSchema>;

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/* -------------------------------------------------------------------------- */
/* La liste elle-même                                                         */
/* -------------------------------------------------------------------------- */

export async function createChecklistAction(input: ChecklistInput) {
  const parsed = checklistSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household, member } = active.data;
  const { name, note, draft } = parsed.data;

  // On range la nouvelle liste après les autres. Une seule requête suffit :
  // la position exacte importe peu, l'ordre relatif seul se voit.
  const { data: derniere } = await supabase
    .from('checklists')
    .select('position')
    .eq('household_id', household.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from('checklists')
    .insert({
      household_id: household.id,
      name,
      note: blankToNull(note),
      position: (derniere?.position ?? -1) + 1,
      created_by: member.user_id,
    })
    .select('id')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  // Une check-list créée vide ne sert à rien : si la personne a collé sa liste,
  // on la remplit dans la foulée plutôt que de la renvoyer sur un écran nu.
  const points = parseChecklistDraft(draft);
  if (points.length > 0) {
    const { error: erreurPoints } = await supabase.from('checklist_items').insert(
      points.map((label, index) => ({
        household_id: household.id,
        checklist_id: data.id,
        label,
        position: index,
      })),
    );
    if (erreurPoints) return fail(humanizeDbError(erreurPoints));
  }

  revalidatePath('/listes');
  return ok({ id: data.id, points: points.length });
}

export async function updateChecklistAction(
  checklistId: string,
  input: Partial<ChecklistInput>,
) {
  const parsed = checklistSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const patch: Database['public']['Tables']['checklists']['Update'] = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.note !== undefined) patch.note = blankToNull(parsed.data.note);

  if (Object.keys(patch).length === 0) return ok();

  const { error } = await active.data.supabase
    .from('checklists')
    .update(patch)
    .eq('id', checklistId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok();
}

export async function deleteChecklistAction(checklistId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('checklists')
    .delete()
    .eq('id', checklistId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* La remise à zéro — le geste qui distingue une check-list d'une liste        */
/* -------------------------------------------------------------------------- */

/**
 * Décoche tout, et note la date.
 *
 * Le contenu ne bouge pas : c'est lui le patrimoine, les coches sont ce qui
 * passe. `checked_at` et `checked_by` sont effacés par le déclencheur, d'où
 * l'unique colonne touchée ici.
 *
 * `last_reset_at` n'est pas décoratif : sans lui, on ne sait pas si les coches
 * encore en place datent de ce matin ou du voyage précédent.
 */
export async function resetChecklistAction(checklistId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household, member } = active.data;

  const { data: liste } = await supabase
    .from('checklists')
    .select('id')
    .eq('id', checklistId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!liste) return fail("Cette check-list n'existe plus.");

  const [pointsResult, listeResult] = await Promise.all([
    supabase
      .from('checklist_items')
      .update({ is_checked: false })
      .eq('checklist_id', checklistId)
      .eq('household_id', household.id)
      .eq('is_checked', true),
    supabase
      .from('checklists')
      .update({ last_reset_at: new Date().toISOString(), last_reset_by: member.id })
      .eq('id', checklistId)
      .eq('household_id', household.id),
  ]);

  const erreur = pointsResult.error ?? listeResult.error;
  if (erreur) return fail(humanizeDbError(erreur));

  revalidatePath('/listes');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Les points                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ajoute un ou plusieurs points, en une fois.
 *
 * Le pluriel n'est pas un luxe : on ajoute rarement une ligne isolée à une
 * valise, on colle ce qu'on a noté ailleurs.
 */
export async function addChecklistItemsAction(checklistId: string, texte: string) {
  const parsed = z.string().max(20_000).safeParse(texte);
  if (!parsed.success) return fail('Cette liste est trop longue.');

  const points = parseChecklistDraft(parsed.data);
  if (points.length === 0) return fail('Rien à ajouter.');

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household } = active.data;

  const { data: liste } = await supabase
    .from('checklists')
    .select('id')
    .eq('id', checklistId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!liste) return fail("Cette check-list n'existe plus.");

  const { data: dernier } = await supabase
    .from('checklist_items')
    .select('position')
    .eq('checklist_id', checklistId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const depart = (dernier?.position ?? -1) + 1;

  const { error } = await supabase.from('checklist_items').insert(
    points.map((label, index) => ({
      household_id: household.id,
      checklist_id: checklistId,
      label,
      position: depart + index,
    })),
  );

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok({ ajoutes: points.length });
}

export async function renameChecklistItemAction(itemId: string, label: string) {
  const parsed = z.string().trim().min(1, 'Un point ne peut pas être vide.').max(120).safeParse(label);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('checklist_items')
    .update({ label: parsed.data })
    .eq('id', itemId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok();
}

export async function toggleChecklistItemAction(itemId: string, checked: boolean) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household, member } = active.data;

  const { error } = await supabase
    .from('checklist_items')
    .update({ is_checked: checked, checked_by: checked ? member.id : null })
    .eq('id', itemId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok();
}

export async function deleteChecklistItemAction(itemId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('checklist_items')
    .delete()
    .eq('id', itemId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/listes');
  return ok();
}
