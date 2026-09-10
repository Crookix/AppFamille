'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { RRule } from 'rrule';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

const taskSchema = z.object({
  title: z.string().trim().min(1, 'Le titre est obligatoire.').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.')
    .nullable()
    .optional()
    .or(z.literal('')),
  dueTime: z.string().trim().nullable().optional().or(z.literal('')),
  priority: z.enum(['basse', 'normale', 'haute']).default('normale'),
  status: z.enum(['a_faire', 'en_cours', 'termine']).optional(),
  childId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  recurrenceRule: z.string().trim().max(400).nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
});

export type TaskInput = z.input<typeof taskSchema>;

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/* -------------------------------------------------------------------------- */
/* Création et modification                                                   */
/* -------------------------------------------------------------------------- */

export async function createTaskAction(input: TaskInput) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const task = parsed.data;
  const { supabase, household, member } = active.data;

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      household_id: household.id,
      title: task.title,
      description: blankToNull(task.description),
      assignee_id: task.assigneeId ?? null,
      due_date: blankToNull(task.dueDate),
      due_time: blankToNull(task.dueTime),
      priority: task.priority,
      status: task.status ?? 'a_faire',
      child_id: task.childId ?? null,
      event_id: task.eventId ?? null,
      recurrence_rule: task.parentTaskId ? null : blankToNull(task.recurrenceRule),
      parent_task_id: task.parentTaskId ?? null,
      created_by: member.user_id,
    })
    .select('id, assignee_id, title')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  await notifyAssignee(supabase, household.id, member, data.id, data.title, data.assignee_id);

  revalidatePath('/');
  revalidatePath('/listes');
  return ok({ id: data.id });
}

export async function updateTaskAction(taskId: string, input: Partial<TaskInput>) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = taskSchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const task = parsed.data;
  const { supabase, household, member } = active.data;

  const { data: before } = await supabase
    .from('tasks')
    .select('assignee_id')
    .eq('id', taskId)
    .eq('household_id', household.id)
    .maybeSingle();

  const patch: Database['public']['Tables']['tasks']['Update'] = {};
  if (task.title !== undefined) patch.title = task.title;
  if (task.description !== undefined) patch.description = blankToNull(task.description);
  if (task.assigneeId !== undefined) patch.assignee_id = task.assigneeId;
  if (task.dueDate !== undefined) patch.due_date = blankToNull(task.dueDate);
  if (task.dueTime !== undefined) patch.due_time = blankToNull(task.dueTime);
  if (task.priority !== undefined) patch.priority = task.priority;
  if (task.status !== undefined) patch.status = task.status;
  if (task.childId !== undefined) patch.child_id = task.childId;
  if (task.eventId !== undefined) patch.event_id = task.eventId;
  if (task.recurrenceRule !== undefined) {
    patch.recurrence_rule = blankToNull(task.recurrenceRule);
  }

  if (Object.keys(patch).length === 0) return ok();

  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', taskId)
    .eq('household_id', household.id)
    .select('id, title, assignee_id')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  // Nouvelle attribution : on prévient la personne concernée.
  if (data.assignee_id && data.assignee_id !== before?.assignee_id) {
    await notifyAssignee(supabase, household.id, member, data.id, data.title, data.assignee_id);
  }

  revalidatePath('/');
  revalidatePath('/listes');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Coche ou décoche une tâche.
 *
 * Sur une tâche récurrente, la valider ne la fait pas disparaître : on archive
 * la réalisation dans l'historique, puis on reporte l'échéance à l'occurrence
 * suivante et la tâche redevient « à faire ». C'est ce qui permet à « sortir
 * les poubelles » d'exister une seule fois pour toutes les semaines.
 */
export async function toggleTaskAction(taskId: string, done: boolean) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household, member } = active.data;

  const { data: task, error: readError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (readError || !task) return fail("Cette tâche n'existe plus.");

  if (done && task.recurrence_rule) {
    await supabase.from('task_completions').insert({
      household_id: household.id,
      task_id: task.id,
      title: task.title,
      due_date: task.due_date,
      completed_by: member.id,
    });

    const nextDue = nextOccurrence(task.recurrence_rule, task.due_date);

    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'a_faire',
        due_date: nextDue,
        completed_at: null,
        completed_by: null,
      })
      .eq('id', taskId)
      .eq('household_id', household.id);

    if (error) return fail(humanizeDbError(error));

    revalidatePath('/');
    revalidatePath('/listes');
    return ok({ recurring: true, nextDue });
  }

  const { error } = await supabase
    .from('tasks')
    .update({
      status: done ? 'termine' : 'a_faire',
      completed_by: done ? member.id : null,
    })
    .eq('id', taskId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  if (done) {
    await supabase.from('task_completions').insert({
      household_id: household.id,
      task_id: task.id,
      title: task.title,
      due_date: task.due_date,
      completed_by: member.id,
    });
  }

  revalidatePath('/');
  revalidatePath('/listes');
  return ok({ recurring: false });
}

/**
 * Échéance suivante d'une tâche récurrente.
 *
 * Le point de départ est l'échéance actuelle si elle existe, sinon
 * aujourd'hui. On avance toujours d'au moins une occurrence, pour qu'une tâche
 * en retard ne se reprogramme pas à une date déjà passée.
 */
function nextOccurrence(rule: string, currentDue: string | null): string | null {
  const from = currentDue ? new Date(`${currentDue}T12:00:00Z`) : new Date();

  try {
    const options = RRule.parseString(rule.replace(/^RRULE:/i, ''));
    const rrule = new RRule({ ...options, dtstart: from });
    const next = rrule.after(from, false);
    if (!next) return null;

    const today = new Date().toISOString().slice(0, 10);
    const candidate = next.toISOString().slice(0, 10);
    // Si la série accumule du retard, on repart d'aujourd'hui.
    if (candidate < today) {
      const catchUp = new RRule({ ...options, dtstart: new Date() }).after(new Date(), false);
      return catchUp ? catchUp.toISOString().slice(0, 10) : candidate;
    }
    return candidate;
  } catch {
    return currentDue;
  }
}

export async function deleteTaskAction(taskId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/');
  revalidatePath('/listes');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Notification d'attribution                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Prévient la personne à qui l'on vient d'attribuer une tâche.
 *
 * On ne se notifie jamais soi-même, et on respecte la préférence de la
 * destinataire. Un échec ici n'invalide pas la tâche : la notification est un
 * confort, pas la donnée.
 */
async function notifyAssignee(
  client: SupabaseClient<Database>,
  householdId: string,
  actor: { id: string; user_id: string; display_name: string },
  taskId: string,
  title: string,
  assigneeId: string | null,
) {
  if (!assigneeId || assigneeId === actor.id) return;

  const { data: assignee } = await client
    .from('household_members')
    .select('user_id')
    .eq('id', assigneeId)
    .maybeSingle();

  const assigneeUserId = assignee?.user_id;
  if (!assigneeUserId || assigneeUserId === actor.user_id) return;

  const { data: prefs } = await client
    .from('notification_preferences')
    .select('tasks_assigned')
    .eq('user_id', assigneeUserId)
    .eq('household_id', householdId)
    .maybeSingle();

  // L'absence de préférence vaut « activé » : le réglage est un retrait.
  if (prefs && prefs.tasks_assigned === false) return;

  await client.from('notifications').insert({
    household_id: householdId,
    user_id: assigneeUserId,
    kind: 'tache_attribuee',
    title: 'Nouvelle tâche pour vous',
    body: `${actor.display_name} vous a attribué « ${title} ».`,
    link: `/listes?onglet=taches&tache=${taskId}`,
    actor_user_id: actor.user_id,
  });
}
