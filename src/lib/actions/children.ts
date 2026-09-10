'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';
import type { Database } from '@/lib/database.types';

const childSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'Le prénom est obligatoire.')
    .max(60, 'Ce prénom est trop long.'),
  birthDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.')
    .nullable()
    .optional()
    .or(z.literal('')),
  color: z.string().trim().max(30).optional(),
  schoolName: z.string().trim().max(120).nullable().optional(),
  schoolContact: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  allergies: z.string().trim().max(1000).nullable().optional(),
});

/** Convertit les chaînes vides en `null` : la base ne stocke pas de vide. */
function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createChildAction(input: z.input<typeof childSchema>) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = childSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const child = parsed.data;

  // Une date de naissance dans le futur est presque toujours une faute de
  // frappe ; on le dit plutôt que de l'enregistrer.
  if (child.birthDate && child.birthDate > new Date().toISOString().slice(0, 10)) {
    return fail('La date de naissance ne peut pas être dans le futur.');
  }

  const { data, error } = await active.data.supabase
    .from('children')
    .insert({
      household_id: active.data.household.id,
      first_name: child.firstName,
      birth_date: blankToNull(child.birthDate),
      color: child.color || 'sauge',
      school_name: blankToNull(child.schoolName),
      school_contact: blankToNull(child.schoolContact),
      notes: blankToNull(child.notes),
      allergies: blankToNull(child.allergies),
    })
    .select('id')
    .single();

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/', 'layout');
  revalidatePath('/plus/enfants');
  return ok({ id: data.id });
}

export async function updateChildAction(
  childId: string,
  input: Partial<z.input<typeof childSchema>>,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = childSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const child = parsed.data;
  const patch: Database['public']['Tables']['children']['Update'] = {};

  if (child.firstName !== undefined) patch.first_name = child.firstName;
  if (child.birthDate !== undefined) patch.birth_date = blankToNull(child.birthDate);
  if (child.color !== undefined) patch.color = child.color;
  if (child.schoolName !== undefined) patch.school_name = blankToNull(child.schoolName);
  if (child.schoolContact !== undefined) patch.school_contact = blankToNull(child.schoolContact);
  if (child.notes !== undefined) patch.notes = blankToNull(child.notes);
  if (child.allergies !== undefined) patch.allergies = blankToNull(child.allergies);

  if (Object.keys(patch).length === 0) return ok();

  const { error } = await active.data.supabase
    .from('children')
    .update(patch)
    .eq('id', childId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/', 'layout');
  revalidatePath('/plus/enfants');
  revalidatePath(`/plus/enfants/${childId}`);
  return ok();
}

/**
 * Retire un enfant du foyer.
 *
 * L'enfant est archivé, pas effacé : ses événements, ses gardes et ses repas
 * passés continuent d'exister et les bilans restent justes.
 */
export async function archiveChildAction(childId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('children')
    .update({ archived: true })
    .eq('id', childId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/', 'layout');
  revalidatePath('/plus/enfants');
  return ok();
}

export async function restoreChildAction(childId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('children')
    .update({ archived: false })
    .eq('id', childId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/', 'layout');
  revalidatePath('/plus/enfants');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Activités régulières                                                       */
/* -------------------------------------------------------------------------- */

const activitySchema = z.object({
  label: z.string().trim().min(1, 'Indiquez le nom de l’activité.').max(80),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  startTime: z.string().trim().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function createChildActivityAction(
  childId: string,
  input: z.input<typeof activitySchema>,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { error } = await active.data.supabase.from('child_activities').insert({
    household_id: active.data.household.id,
    child_id: childId,
    label: parsed.data.label,
    weekday: parsed.data.weekday ?? null,
    start_time: blankToNull(parsed.data.startTime),
    end_time: blankToNull(parsed.data.endTime),
    location: blankToNull(parsed.data.location),
    notes: blankToNull(parsed.data.notes),
  });

  if (error) return fail(humanizeDbError(error));

  revalidatePath(`/plus/enfants/${childId}`);
  return ok();
}

export async function deleteChildActivityAction(activityId: string, childId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('child_activities')
    .delete()
    .eq('id', activityId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath(`/plus/enfants/${childId}`);
  return ok();
}
