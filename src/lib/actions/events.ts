'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, EventCategory, EventKind, TransportMode } from '@/lib/database.types';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

const CATEGORIES = [
  'famille',
  'ecole',
  'sante',
  'activite',
  'voyage',
  'garde',
  'perso',
] as const;

const TRANSPORTS = ['train', 'avion', 'voiture', 'bus', 'bateau', 'velo', 'autre'] as const;

const tripSchema = z.object({
  transportMode: z.enum(TRANSPORTS).default('train'),
  departurePlace: z.string().trim().max(160).nullable().optional(),
  departureAt: z.string().trim().nullable().optional(),
  departureTz: z.string().trim().max(64).default('Europe/Paris'),
  arrivalPlace: z.string().trim().max(160).nullable().optional(),
  arrivalAt: z.string().trim().nullable().optional(),
  arrivalTz: z.string().trim().max(64).default('Europe/Paris'),
  carrierNumber: z.string().trim().max(40).nullable().optional(),
  bookingRef: z.string().trim().max(60).nullable().optional(),
  seatInfo: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const eventSchema = z.object({
  title: z.string().trim().min(1, 'Le titre est obligatoire.').max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  category: z.enum(CATEGORIES).default('famille'),
  kind: z.enum(['standard', 'deplacement', 'garde']).default('standard'),
  startsAt: z.string().min(1, 'La date de début est obligatoire.'),
  endsAt: z.string().min(1, 'La date de fin est obligatoire.'),
  allDay: z.boolean().default(false),
  timezone: z.string().trim().min(1).max(64).default('Europe/Paris'),
  location: z.string().trim().max(160).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  responsibleMemberId: z.string().uuid().nullable().optional(),
  dropoffMemberId: z.string().uuid().nullable().optional(),
  pickupMemberId: z.string().uuid().nullable().optional(),
  recurrenceRule: z.string().trim().max(400).nullable().optional(),
  memberIds: z.array(z.string().uuid()).default([]),
  childIds: z.array(z.string().uuid()).default([]),
  reminders: z.array(z.number().int().min(0).max(40320)).default([]),
  trip: tripSchema.nullable().optional(),
});

export type EventInput = z.input<typeof eventSchema>;

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Vérifie la cohérence des dates avant toute écriture. */
function validateDates(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Les dates saisies ne sont pas valides.';
  }
  if (end < start) return 'La fin ne peut pas précéder le début.';
  return null;
}

/**
 * Enregistre participants, rappels et détails de déplacement d'un événement.
 *
 * Ces trois tables sont réécrites entièrement plutôt que comparées ligne à
 * ligne : les volumes sont minuscules (quelques lignes) et cela évite toute
 * dérive entre l'affichage et la base.
 */
async function saveRelations(
  client: SupabaseClient<Database>,
  householdId: string,
  eventId: string,
  input: z.output<typeof eventSchema>,
) {
  await client.from('event_participants').delete().eq('event_id', eventId);
  await client.from('event_reminders').delete().eq('event_id', eventId);

  const participants = [
    ...input.memberIds.map((id) => ({
      household_id: householdId,
      event_id: eventId,
      member_id: id,
      child_id: null,
    })),
    ...input.childIds.map((id) => ({
      household_id: householdId,
      event_id: eventId,
      member_id: null,
      child_id: id,
    })),
  ];
  if (participants.length > 0) {
    await client.from('event_participants').insert(participants);
  }

  const reminders = [...new Set(input.reminders)].map((minutes) => ({
    household_id: householdId,
    event_id: eventId,
    minutes_before: minutes,
  }));
  if (reminders.length > 0) {
    await client.from('event_reminders').insert(reminders);
  }

  if (input.kind === 'deplacement' && input.trip) {
    await client.from('trip_details').upsert(
      {
        event_id: eventId,
        household_id: householdId,
        transport_mode: input.trip.transportMode as TransportMode,
        departure_place: blankToNull(input.trip.departurePlace),
        departure_at: blankToNull(input.trip.departureAt),
        departure_tz: input.trip.departureTz,
        arrival_place: blankToNull(input.trip.arrivalPlace),
        arrival_at: blankToNull(input.trip.arrivalAt),
        arrival_tz: input.trip.arrivalTz,
        carrier_number: blankToNull(input.trip.carrierNumber),
        booking_ref: blankToNull(input.trip.bookingRef),
        seat_info: blankToNull(input.trip.seatInfo),
        notes: blankToNull(input.trip.notes),
      },
      { onConflict: 'event_id' },
    );
  } else {
    await client.from('trip_details').delete().eq('event_id', eventId);
  }
}

/* -------------------------------------------------------------------------- */
/* Création                                                                   */
/* -------------------------------------------------------------------------- */

export async function createEventAction(input: EventInput) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const event = parsed.data;
  const dateError = validateDates(event.startsAt, event.endsAt);
  if (dateError) return fail(dateError);

  const { supabase, household, member } = active.data;

  const { data, error } = await supabase
    .from('events')
    .insert({
      household_id: household.id,
      title: event.title,
      description: blankToNull(event.description),
      category: event.category as EventCategory,
      kind: event.kind as EventKind,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      all_day: event.allDay,
      timezone: event.timezone,
      location: blankToNull(event.location),
      address: blankToNull(event.address),
      responsible_member_id: event.responsibleMemberId ?? null,
      dropoff_member_id: event.dropoffMemberId ?? null,
      pickup_member_id: event.pickupMemberId ?? null,
      recurrence_rule: blankToNull(event.recurrenceRule),
      origin: 'tribu',
      created_by: member.user_id,
    })
    .select('id')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  await saveRelations(supabase, household.id, data.id, event);

  revalidatePath('/');
  revalidatePath('/calendrier');
  return ok({ id: data.id });
}

/* -------------------------------------------------------------------------- */
/* Modification                                                               */
/* -------------------------------------------------------------------------- */

export type EditScope = 'occurrence' | 'serie';

/**
 * Modifie un événement.
 *
 * Sur une série, `scope` décide du geste :
 *  - « serie » modifie l'événement maître, donc toutes les occurrences ;
 *  - « occurrence » crée (ou met à jour) une exception qui ne remplace que
 *    l'occurrence désignée par `occurrenceStart`, exactement comme le fait
 *    Google Calendar. Les autres occurrences ne bougent pas.
 */
export async function updateEventAction(
  eventId: string,
  input: EventInput,
  options: { scope?: EditScope; occurrenceStart?: string } = {},
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const event = parsed.data;
  const dateError = validateDates(event.startsAt, event.endsAt);
  if (dateError) return fail(dateError);

  const { supabase, household, member } = active.data;

  const { data: existing, error: readError } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (readError || !existing) return fail("Cet événement n'existe plus.");

  const scope = options.scope ?? 'serie';
  const isSeries = Boolean(existing.recurrence_rule);

  if (isSeries && scope === 'occurrence') {
    if (!options.occurrenceStart) {
      return fail("L'occurrence à modifier n'a pas été précisée.");
    }

    const { data: exception, error: exceptionError } = await supabase
      .from('events')
      .upsert(
        {
          household_id: household.id,
          title: event.title,
          description: blankToNull(event.description),
          category: event.category as EventCategory,
          kind: event.kind as EventKind,
          starts_at: event.startsAt,
          ends_at: event.endsAt,
          all_day: event.allDay,
          timezone: event.timezone,
          location: blankToNull(event.location),
          address: blankToNull(event.address),
          responsible_member_id: event.responsibleMemberId ?? null,
          dropoff_member_id: event.dropoffMemberId ?? null,
          pickup_member_id: event.pickupMemberId ?? null,
          // Une exception ne porte jamais de règle de récurrence propre.
          recurrence_rule: null,
          recurring_parent_id: eventId,
          original_starts_at: options.occurrenceStart,
          is_cancelled: false,
          origin: existing.origin,
          google_calendar_ref: existing.google_calendar_ref,
          created_by: member.user_id,
        },
        { onConflict: 'recurring_parent_id,original_starts_at' },
      )
      .select('id')
      .single();

    if (exceptionError || !exception) return fail(humanizeDbError(exceptionError));

    await saveRelations(supabase, household.id, exception.id, event);

    revalidatePath('/');
    revalidatePath('/calendrier');
    return ok({ id: exception.id });
  }

  const { error } = await supabase
    .from('events')
    .update({
      title: event.title,
      description: blankToNull(event.description),
      category: event.category as EventCategory,
      kind: event.kind as EventKind,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      all_day: event.allDay,
      timezone: event.timezone,
      location: blankToNull(event.location),
      address: blankToNull(event.address),
      responsible_member_id: event.responsibleMemberId ?? null,
      dropoff_member_id: event.dropoffMemberId ?? null,
      pickup_member_id: event.pickupMemberId ?? null,
      recurrence_rule: existing.recurring_parent_id
        ? null
        : blankToNull(event.recurrenceRule),
    })
    .eq('id', eventId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  await saveRelations(supabase, household.id, eventId, event);

  revalidatePath('/');
  revalidatePath('/calendrier');
  return ok({ id: eventId });
}

/* -------------------------------------------------------------------------- */
/* Suppression                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Supprime un événement ou une seule de ses occurrences.
 *
 * Supprimer une occurrence n'efface rien : on enregistre une exception
 * annulée, ce qui est réversible et se transpose directement en EXDATE côté
 * Google.
 */
export async function deleteEventAction(
  eventId: string,
  options: { scope?: EditScope; occurrenceStart?: string } = {},
) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household, member } = active.data;

  const { data: existing } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!existing) return fail("Cet événement n'existe plus.");

  const scope = options.scope ?? 'serie';

  if (existing.recurrence_rule && scope === 'occurrence') {
    if (!options.occurrenceStart) {
      return fail("L'occurrence à supprimer n'a pas été précisée.");
    }

    const { error } = await supabase.from('events').upsert(
      {
        household_id: household.id,
        title: existing.title,
        category: existing.category,
        kind: existing.kind,
        starts_at: options.occurrenceStart,
        ends_at: options.occurrenceStart,
        all_day: existing.all_day,
        timezone: existing.timezone,
        recurrence_rule: null,
        recurring_parent_id: eventId,
        original_starts_at: options.occurrenceStart,
        is_cancelled: true,
        origin: existing.origin,
        google_calendar_ref: existing.google_calendar_ref,
        created_by: member.user_id,
      },
      { onConflict: 'recurring_parent_id,original_starts_at' },
    );

    if (error) return fail(humanizeDbError(error));

    revalidatePath('/');
    revalidatePath('/calendrier');
    return ok();
  }

  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/');
  revalidatePath('/calendrier');
  return ok();
}

/** Rétablit une occurrence précédemment supprimée d'une série. */
export async function restoreOccurrenceAction(parentId: string, occurrenceStart: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { error } = await active.data.supabase
    .from('events')
    .delete()
    .eq('recurring_parent_id', parentId)
    .eq('original_starts_at', occurrenceStart)
    .eq('is_cancelled', true)
    .eq('household_id', active.data.household.id);

  if (error) return fail(humanizeDbError(error));

  revalidatePath('/calendrier');
  return ok();
}
