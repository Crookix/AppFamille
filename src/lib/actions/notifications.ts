'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

export async function markNotificationReadAction(notificationId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', active.data.member.user_id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus');
  revalidatePath('/plus/notifications');
  // La puce de l'entête est calculée dans la coque des écrans connectés :
  // sans revalidation de la disposition, elle resterait allumée alors que
  // la notification vient d'être lue.
  revalidatePath('/', 'layout');
  return ok();
}

export async function markAllNotificationsReadAction() {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', active.data.member.user_id)
    .is('read_at', null);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus');
  revalidatePath('/plus/notifications');
  // La puce de l'entête est calculée dans la coque des écrans connectés :
  // sans revalidation de la disposition, elle resterait allumée alors que
  // la notification vient d'être lue.
  revalidatePath('/', 'layout');
  return ok();
}

export async function deleteNotificationAction(notificationId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId)
    .eq('user_id', active.data.member.user_id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus/notifications');
  // La puce de l'entête est calculée dans la coque des écrans connectés :
  // sans revalidation de la disposition, elle resterait allumée alors que
  // la notification vient d'être lue.
  revalidatePath('/', 'layout');
  return ok();
}

const preferencesSchema = z.object({
  tasksAssigned: z.boolean().optional(),
  tasksCompleted: z.boolean().optional(),
  eventsChanged: z.boolean().optional(),
  eventReminders: z.boolean().optional(),
  childcareToConfirm: z.boolean().optional(),
  googleSyncErrors: z.boolean().optional(),
});

/**
 * Enregistre les préférences de notification de la personne connectée.
 *
 * Chaque adulte règle les siennes : ce n'est pas un paramètre du foyer.
 * La ligne est créée à la volée si elle n'existe pas — l'absence de réglage
 * vaut « tout activé ».
 */
export async function updateNotificationPreferencesAction(
  input: z.input<typeof preferencesSchema>,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const p = parsed.data;
  const patch: Record<string, boolean> = {};
  if (p.tasksAssigned !== undefined) patch.tasks_assigned = p.tasksAssigned;
  if (p.tasksCompleted !== undefined) patch.tasks_completed = p.tasksCompleted;
  if (p.eventsChanged !== undefined) patch.events_changed = p.eventsChanged;
  if (p.eventReminders !== undefined) patch.event_reminders = p.eventReminders;
  if (p.childcareToConfirm !== undefined) patch.childcare_to_confirm = p.childcareToConfirm;
  if (p.googleSyncErrors !== undefined) patch.google_sync_errors = p.googleSyncErrors;

  if (Object.keys(patch).length === 0) return ok();

  const { error } = await active.data.supabase.from('notification_preferences').upsert(
    {
      household_id: active.data.household.id,
      user_id: active.data.member.user_id,
      ...patch,
    },
    { onConflict: 'household_id,user_id' },
  );

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus/notifications');
  return ok();
}
