'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { expandRule } from '@/lib/recurrence';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';
import type { Database } from '@/lib/database.types';

/* -------------------------------------------------------------------------- */
/* Nounous                                                                    */
/* -------------------------------------------------------------------------- */

const nannySchema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(80),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(160).nullable().optional(),
  color: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  hourlyRate: z.number().min(0, 'Le tarif ne peut pas être négatif.').nullable().optional(),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.')
    .optional(),
});

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createNannyAction(input: z.input<typeof nannySchema>) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = nannySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const nanny = parsed.data;
  const { supabase, household } = active.data;

  const { data, error } = await supabase
    .from('nannies')
    .insert({
      household_id: household.id,
      name: nanny.name,
      phone: blankToNull(nanny.phone),
      email: blankToNull(nanny.email),
      color: nanny.color || 'lavande',
      notes: blankToNull(nanny.notes),
    })
    .select('id')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  if (nanny.hourlyRate !== null && nanny.hourlyRate !== undefined) {
    await supabase.from('nanny_rates').insert({
      household_id: household.id,
      nanny_id: data.id,
      hourly_rate: nanny.hourlyRate,
      effective_from: nanny.effectiveFrom ?? new Date().toISOString().slice(0, 10),
    });
  }

  revalidatePath('/plus/nounous');
  return ok({ id: data.id });
}

export async function updateNannyAction(
  nannyId: string,
  input: Partial<z.input<typeof nannySchema>>,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = nannySchema.partial().safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const nanny = parsed.data;
  const patch: Database['public']['Tables']['nannies']['Update'] = {};
  if (nanny.name !== undefined) patch.name = nanny.name;
  if (nanny.phone !== undefined) patch.phone = blankToNull(nanny.phone);
  if (nanny.email !== undefined) patch.email = blankToNull(nanny.email);
  if (nanny.color !== undefined) patch.color = nanny.color;
  if (nanny.notes !== undefined) patch.notes = blankToNull(nanny.notes);

  if (Object.keys(patch).length > 0) {
    const { error } = await active.data.supabase
      .from('nannies')
      .update(patch)
      .eq('id', nannyId)
      .eq('household_id', active.data.household.id);
    if (error) return fail(humanizeDbError(error));
  }

  revalidatePath('/plus/nounous');
  revalidatePath(`/plus/nounous/${nannyId}`);
  return ok();
}

/**
 * Enregistre un nouveau tarif horaire à partir d'une date.
 *
 * Les gardes déjà créées portent leur propre tarif : ce changement ne les
 * touche pas, et les bilans passés restent identiques.
 */
export async function setNannyRateAction(
  nannyId: string,
  hourlyRate: number,
  effectiveFrom: string,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = z
    .object({
      hourlyRate: z.number().min(0, 'Le tarif ne peut pas être négatif.'),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.'),
    })
    .safeParse({ hourlyRate, effectiveFrom });

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { error } = await active.data.supabase.from('nanny_rates').upsert(
    {
      household_id: active.data.household.id,
      nanny_id: nannyId,
      hourly_rate: parsed.data.hourlyRate,
      effective_from: parsed.data.effectiveFrom,
    },
    { onConflict: 'nanny_id,effective_from' },
  );

  if (error) return fail(humanizeDbError(error));

  revalidatePath(`/plus/nounous/${nannyId}`);
  return ok();
}

export async function deleteNannyRateAction(rateId: string, nannyId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('nanny_rates')
    .delete()
    .eq('id', rateId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath(`/plus/nounous/${nannyId}`);
  return ok();
}

/**
 * Désactive une nounou sans effacer son historique.
 *
 * Les gardes passées, leurs heures et leurs montants doivent rester
 * consultables : c'est un suivi, pas une fiche jetable.
 */
export async function archiveNannyAction(nannyId: string, active_: boolean) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('nannies')
    .update({ is_active: active_ })
    .eq('id', nannyId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus/nounous');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Gardes                                                                     */
/* -------------------------------------------------------------------------- */

const sessionSchema = z.object({
  nannyId: z.string().uuid("Choisissez une nounou."),
  scheduledStart: z.string().min(1, 'Indiquez le début de la garde.'),
  scheduledEnd: z.string().min(1, 'Indiquez la fin de la garde.'),
  childIds: z.array(z.string().uuid()).default([]),
  location: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  hourlyRate: z.number().min(0).nullable().optional(),
  /** Répétition : une garde par occurrence est créée. */
  recurrenceRule: z.string().trim().max(400).nullable().optional(),
  recurrenceUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export type ChildcareInput = z.input<typeof sessionSchema>;

/** Limite du nombre de gardes générées d'un coup par une répétition. */
const MAX_GENERATED = 60;

/**
 * Planifie une garde, ponctuelle ou récurrente.
 *
 * Une garde récurrente est matérialisée en gardes individuelles plutôt que
 * gardée sous forme de règle : chacune aura ses propres heures réelles, son
 * propre tarif figé et son propre statut de confirmation. Une règle abstraite
 * ne permettrait pas de dire « ce mardi-là, elle est restée 20 minutes de
 * plus ».
 */
export async function createChildcareSessionAction(input: ChildcareInput) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = sessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const session = parsed.data;
  const { supabase, household, member } = active.data;

  const start = new Date(session.scheduledStart);
  const end = new Date(session.scheduledEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return fail('Les horaires saisis ne sont pas valides.');
  }
  if (end <= start) {
    return fail('La fin de la garde doit suivre son début.');
  }

  const { data: nanny } = await supabase
    .from('nannies')
    .select('id, name')
    .eq('id', session.nannyId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!nanny) return fail("Cette nounou n'existe plus.");

  // Tarif figé : celui fourni, sinon celui en vigueur à la date de la garde.
  let rate = session.hourlyRate;
  if (rate === null || rate === undefined) {
    const { data } = await supabase.rpc('nanny_rate_at', {
      p_nanny_id: session.nannyId,
      p_on: start.toISOString().slice(0, 10),
    });
    rate = data === null || data === undefined ? null : Number(data);
  }
  if (rate === null || rate === undefined) {
    return fail(
      "Aucun tarif horaire n'est défini pour cette nounou. Renseignez-le sur sa fiche.",
    );
  }

  // Dates de toutes les occurrences à créer.
  const durationMs = end.getTime() - start.getTime();
  let starts: Date[] = [start];

  if (session.recurrenceRule) {
    const until = session.recurrenceUntil
      ? new Date(`${session.recurrenceUntil}T23:59:59Z`)
      : new Date(start.getTime() + 180 * 24 * 60 * 60 * 1000);

    starts = expandRule(
      session.recurrenceRule,
      start,
      start,
      until,
      household.timezone,
    ).slice(0, MAX_GENERATED);

    if (starts.length === 0) starts = [start];
  }

  const createdIds: string[] = [];

  for (const occurrenceStart of starts) {
    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);

    // Événement miroir dans le calendrier familial.
    const { data: event } = await supabase
      .from('events')
      .insert({
        household_id: household.id,
        title: `Garde — ${nanny.name}`,
        category: 'garde',
        kind: 'garde',
        starts_at: occurrenceStart.toISOString(),
        ends_at: occurrenceEnd.toISOString(),
        all_day: false,
        timezone: household.timezone,
        location: blankToNull(session.location),
        origin: 'tribu',
        created_by: member.user_id,
      })
      .select('id')
      .single();

    const { data: created, error } = await supabase
      .from('childcare_sessions')
      .insert({
        household_id: household.id,
        nanny_id: session.nannyId,
        event_id: event?.id ?? null,
        scheduled_start: occurrenceStart.toISOString(),
        scheduled_end: occurrenceEnd.toISOString(),
        applied_hourly_rate: rate,
        status: 'prevue',
        location: blankToNull(session.location),
        notes: blankToNull(session.notes),
        created_by: member.user_id,
      })
      .select('id')
      .single();

    if (error || !created) {
      // L'événement miroir sans garde n'a pas de sens : on le retire.
      if (event?.id) await supabase.from('events').delete().eq('id', event.id);
      return fail(humanizeDbError(error));
    }

    createdIds.push(created.id);

    if (session.childIds.length > 0) {
      await supabase.from('childcare_session_children').insert(
        session.childIds.map((childId) => ({
          household_id: household.id,
          session_id: created.id,
          child_id: childId,
        })),
      );

      if (event?.id) {
        await supabase.from('event_participants').insert(
          session.childIds.map((childId) => ({
            household_id: household.id,
            event_id: event.id,
            child_id: childId,
          })),
        );
      }
    }
  }

  revalidatePath('/');
  revalidatePath('/calendrier');
  revalidatePath('/plus/nounous');
  return ok({ ids: createdIds, count: createdIds.length });
}

const hoursSchema = z.object({
  actualStart: z.string().nullable(),
  actualEnd: z.string().nullable(),
  unpaidBreakMinutes: z.number().int().min(0, 'Les pauses ne peuvent pas être négatives.'),
  confirm: z.boolean().default(false),
  extras: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Le libellé du frais est obligatoire.').max(80),
        amount: z.number(),
      }),
    )
    .default([]),
});

/**
 * Saisit ou confirme les heures réellement effectuées.
 *
 * Les horaires prévus ne sont jamais écrasés : ils restent affichés à côté des
 * heures réelles, ce qui permet de voir d'un coup d'œil les écarts.
 */
export async function saveChildcareHoursAction(
  sessionId: string,
  input: z.input<typeof hoursSchema>,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = hoursSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const hours = parsed.data;
  const { supabase, household, member } = active.data;

  if ((hours.actualStart === null) !== (hours.actualEnd === null)) {
    return fail('Indiquez à la fois le début et la fin réels, ou aucun des deux.');
  }

  if (hours.actualStart && hours.actualEnd) {
    const start = new Date(hours.actualStart);
    const end = new Date(hours.actualEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return fail('Les horaires saisis ne sont pas valides.');
    }
    if (end <= start) {
      // Une garde qui passe minuit reste valide : c'est la DATE de fin qui
      // doit être le lendemain, pas seulement l'heure.
      return fail(
        'La fin doit suivre le début. Pour une garde qui passe minuit, indiquez la date du lendemain.',
      );
    }
  }

  const { error } = await supabase
    .from('childcare_sessions')
    .update({
      actual_start: hours.actualStart,
      actual_end: hours.actualEnd,
      unpaid_break_minutes: hours.unpaidBreakMinutes,
      status: hours.confirm ? 'confirmee' : hours.actualStart ? 'a_confirmer' : 'prevue',
      confirmed_by: hours.confirm ? member.id : null,
    })
    .eq('id', sessionId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  // Les frais sont réécrits en bloc : leur nombre est minuscule et cela évite
  // toute dérive entre l'écran et la base.
  await supabase.from('childcare_extras').delete().eq('session_id', sessionId);

  if (hours.extras.length > 0) {
    const { error: extrasError } = await supabase.from('childcare_extras').insert(
      hours.extras.map((extra) => ({
        household_id: household.id,
        session_id: sessionId,
        label: extra.label,
        amount: extra.amount,
      })),
    );
    if (extrasError) return fail(humanizeDbError(extrasError));
  }

  revalidatePath('/');
  revalidatePath('/plus/nounous');
  return ok();
}

/**
 * Applique une correction manuelle sur la durée d'une garde.
 *
 * La correction est stockée à part et exige un motif : les heures saisies
 * restent intactes, et le bilan garde la trace de ce qui a été ajusté et
 * pourquoi.
 */
export async function adjustChildcareAction(
  sessionId: string,
  minutes: number,
  reason: string,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = z
    .object({
      minutes: z.number().int().min(-720).max(720),
      reason: z.string().trim().max(300),
    })
    .safeParse({ minutes, reason });

  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (parsed.data.minutes !== 0 && !parsed.data.reason) {
    return fail('Une correction manuelle doit être motivée.');
  }

  const { error } = await active.data.supabase
    .from('childcare_sessions')
    .update({
      adjustment_minutes: parsed.data.minutes,
      adjustment_reason: parsed.data.minutes === 0 ? null : parsed.data.reason,
      adjusted_by: active.data.member.id,
    })
    .eq('id', sessionId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus/nounous');
  return ok();
}

export async function setChildcareStatusAction(
  sessionId: string,
  status: 'prevue' | 'a_confirmer' | 'confirmee' | 'annulee',
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('childcare_sessions')
    .update({
      status,
      confirmed_by: status === 'confirmee' ? active.data.member.id : null,
    })
    .eq('id', sessionId)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/');
  revalidatePath('/plus/nounous');
  return ok();
}

/** Supprime une garde et son événement miroir. */
export async function deleteChildcareSessionAction(sessionId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household } = active.data;

  const { data: session } = await supabase
    .from('childcare_sessions')
    .select('event_id')
    .eq('id', sessionId)
    .eq('household_id', household.id)
    .maybeSingle();

  const { error } = await supabase
    .from('childcare_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  if (session?.event_id) {
    await supabase.from('events').delete().eq('id', session.event_id);
  }

  revalidatePath('/');
  revalidatePath('/calendrier');
  revalidatePath('/plus/nounous');
  return ok();
}

/* -------------------------------------------------------------------------- */
/* Règlements                                                                 */
/* -------------------------------------------------------------------------- */

export async function setSettlementStatusAction(
  nannyId: string,
  month: string,
  status: 'a_payer' | 'paye',
  paidAt: string | null,
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = z
    .object({
      month: z.string().regex(/^\d{4}-\d{2}-01$/, 'Mois invalide.'),
      paidAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    })
    .safeParse({ month, paidAt });

  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { error } = await active.data.supabase.from('nanny_settlements').upsert(
    {
      household_id: active.data.household.id,
      nanny_id: nannyId,
      month: parsed.data.month,
      status,
      paid_at: status === 'paye' ? (parsed.data.paidAt ?? new Date().toISOString().slice(0, 10)) : null,
    },
    { onConflict: 'nanny_id,month' },
  );

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus/nounous');
  return ok();
}
