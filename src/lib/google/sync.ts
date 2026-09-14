import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, EventRow, GoogleCalendarRow } from '@/lib/database.types';
import {
  GoogleAuthError,
  GoogleCalendarClient,
  GoogleSyncTokenExpired,
} from '@/lib/google/client';
import {
  canWrite,
  googleToLocal,
  isTribuOrigin,
  localToGoogle,
  type GoogleEvent,
} from '@/lib/google/mapping';

/**
 * Moteur de synchronisation Google Agenda.
 *
 * Trois principes gouvernent tout ce fichier :
 *
 * 1. **Anti-doublon.** Une paire (calendrier Google, identifiant Google) ne
 *    peut correspondre qu'à un seul événement MyFamily, garanti par un index
 *    unique. Aucune reconnaissance « par ressemblance » n'est tentée.
 *
 * 2. **Anti-boucle.** Un événement importé porte `origin = 'google'` et n'est
 *    JAMAIS réexporté. Un événement MyFamily n'est réexporté que si sa révision a
 *    bougé depuis le dernier envoi. L'etag renvoyé par Google sert d'accusé :
 *    s'il n'a pas changé, ce qui revient est notre propre écho.
 *
 * 3. **Rien ne disparaît en silence.** Une suppression côté Google n'efface un
 *    événement MyFamily que s'il venait de Google. Un événement créé dans MyFamily
 *    et effacé chez Google perd sa correspondance mais garde ses données, ses
 *    participants et ses pièces jointes.
 */

/** Fenêtre de la première synchronisation. */
const INITIAL_WINDOW_PAST_DAYS = 90;
const INITIAL_WINDOW_FUTURE_DAYS = 365;

export type SyncOutcome = {
  calendarId: string;
  calendarName: string;
  imported: number;
  updated: number;
  exported: number;
  deleted: number;
  conflicts: number;
  status: 'succes' | 'echec';
  error?: string;
};

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

type ImportCounters = { imported: number; updated: number; deleted: number };

async function applyRemoteEvent(
  admin: SupabaseClient<Database>,
  calendar: GoogleCalendarRow,
  remote: GoogleEvent,
  counters: ImportCounters,
): Promise<void> {
  if (!remote.id) return;

  const { data: link } = await admin
    .from('google_event_links')
    .select('*')
    .eq('google_calendar_ref', calendar.id)
    .eq('google_event_id', remote.id)
    .maybeSingle();

  /* --- Suppression côté Google ----------------------------------------- */
  if (remote.status === 'cancelled') {
    if (!link) return;

    const { data: local } = await admin
      .from('events')
      .select('id, origin')
      .eq('id', link.event_id)
      .maybeSingle();

    if (local?.origin === 'google') {
      // Miroir d'un événement Google : il disparaît avec lui.
      await admin.from('events').delete().eq('id', link.event_id);
      counters.deleted += 1;
    } else if (local) {
      // Événement du foyer : on coupe le lien, mais on ne touche pas aux
      // données familiales. La suppression restera à confirmer dans MyFamily.
      await admin
        .from('google_event_links')
        .update({ deleted_remotely: true, last_synced_at: new Date().toISOString() })
        .eq('id', link.id);
    } else {
      await admin.from('google_event_links').delete().eq('id', link.id);
    }
    return;
  }

  /* --- Écho de nos propres écritures ------------------------------------ */
  // L'etag n'a pas bougé depuis notre dernier envoi : rien de neuf côté
  // Google, inutile de réécrire quoi que ce soit.
  if (link && remote.etag && link.etag === remote.etag) {
    await admin
      .from('google_event_links')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', link.id);
    return;
  }

  const mapped = googleToLocal(remote, {
    shareMode: calendar.share_mode,
    fallbackTimezone: calendar.time_zone ?? 'Europe/Paris',
  });
  if (!mapped) return;

  /* --- Rattachement d'une occurrence à sa série ------------------------- */
  let parentEventId: string | null = null;
  if (mapped.googleRecurringEventId) {
    const { data: parentLink } = await admin
      .from('google_event_links')
      .select('event_id')
      .eq('google_calendar_ref', calendar.id)
      .eq('google_event_id', mapped.googleRecurringEventId)
      .maybeSingle();
    parentEventId = parentLink?.event_id ?? null;

    // La série n'est pas encore importée : on repassera. Créer l'occurrence
    // sans sa série produirait un événement isolé, donc un doublon apparent.
    if (!parentEventId) return;
  }

  const payload = {
    household_id: calendar.household_id,
    title: mapped.title,
    description: mapped.description,
    location: mapped.location,
    category: mapped.category,
    kind: 'standard' as const,
    starts_at: mapped.startsAt,
    ends_at: mapped.endsAt,
    all_day: mapped.allDay,
    timezone: mapped.timezone,
    recurrence_rule: parentEventId ? null : mapped.recurrenceRule,
    recurring_parent_id: parentEventId,
    original_starts_at: parentEventId ? mapped.originalStartsAt : null,
    is_cancelled: false,
    origin: 'google' as const,
    google_calendar_ref: calendar.id,
    is_busy_only: mapped.isBusyOnly,
  };

  if (link) {
    const { data: updated } = await admin
      .from('events')
      .update(payload)
      .eq('id', link.event_id)
      .select('revision')
      .single();

    await admin
      .from('google_event_links')
      .update({
        etag: remote.etag ?? null,
        remote_updated_at: remote.updated ?? null,
        google_ical_uid: remote.iCalUID ?? null,
        google_recurring_event_id: mapped.googleRecurringEventId,
        // La révision vient d'être incrémentée par l'écriture ci-dessus.
        // On l'enregistre comme « déjà envoyée » : sans cela, l'export
        // renverrait aussitôt à Google ce qu'on vient d'en recevoir.
        pushed_revision: updated?.revision ?? null,
        last_synced_at: new Date().toISOString(),
        deleted_remotely: false,
      })
      .eq('id', link.id);

    counters.updated += 1;
    return;
  }

  const { data: created, error } = await admin
    .from('events')
    .insert(payload)
    .select('id, revision')
    .single();

  if (error || !created) return;

  await admin.from('google_event_links').insert({
    household_id: calendar.household_id,
    event_id: created.id,
    google_calendar_ref: calendar.id,
    google_event_id: remote.id,
    google_ical_uid: remote.iCalUID ?? null,
    google_recurring_event_id: mapped.googleRecurringEventId,
    etag: remote.etag ?? null,
    remote_updated_at: remote.updated ?? null,
    pushed_revision: created.revision,
    last_synced_at: new Date().toISOString(),
  });

  counters.imported += 1;
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

async function exportLocalEvents(
  admin: SupabaseClient<Database>,
  client: GoogleCalendarClient,
  calendar: GoogleCalendarRow,
): Promise<{ exported: number; conflicts: number }> {
  let exported = 0;
  let conflicts = 0;

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 30);

  // Seuls les événements NÉS dans MyFamily partent vers Google. Un événement
  // importé n'est jamais renvoyé : c'est la garde la plus simple contre les
  // boucles, et elle ne peut pas se tromper.
  const { data: candidates } = await admin
    .from('events')
    .select('*')
    .eq('household_id', calendar.household_id)
    .eq('origin', 'tribu')
    .eq('is_cancelled', false)
    .is('recurring_parent_id', null)
    .gte('ends_at', windowStart.toISOString())
    .limit(500);

  for (const event of (candidates ?? []) as EventRow[]) {
    const { data: link } = await admin
      .from('google_event_links')
      .select('*')
      .eq('event_id', event.id)
      .eq('google_calendar_ref', calendar.id)
      .maybeSingle();

    // Rien n'a changé depuis le dernier envoi.
    if (link && link.pushed_revision === event.revision) continue;
    // Google a supprimé cette copie : on ne la recrée pas dans son dos.
    if (link?.deleted_remotely) continue;

    const body = localToGoogle(event);

    try {
      if (link) {
        const updated = await client.patchEvent(
          calendar.google_calendar_id,
          link.google_event_id,
          body,
          link.etag,
        );

        await admin
          .from('google_event_links')
          .update({
            etag: updated.etag ?? null,
            remote_updated_at: updated.updated ?? null,
            pushed_revision: event.revision,
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', link.id);
      } else {
        const created = await client.insertEvent(calendar.google_calendar_id, body);
        if (!created.id) continue;

        await admin.from('google_event_links').insert({
          household_id: calendar.household_id,
          event_id: event.id,
          google_calendar_ref: calendar.id,
          google_event_id: created.id,
          google_ical_uid: created.iCalUID ?? null,
          etag: created.etag ?? null,
          remote_updated_at: created.updated ?? null,
          pushed_revision: event.revision,
          last_synced_at: new Date().toISOString(),
        });
      }

      exported += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      // 412 : l'etag ne correspond plus, quelqu'un a modifié l'événement dans
      // Google entre-temps. On n'écrase pas : le prochain import rapatriera
      // sa version, et la modification locale sera reproposée ensuite.
      if (message.includes('412')) {
        conflicts += 1;
        await admin
          .from('google_event_links')
          .update({ etag: null })
          .eq('event_id', event.id)
          .eq('google_calendar_ref', calendar.id);
        continue;
      }
      if (error instanceof GoogleAuthError) throw error;
      // Un événement en échec ne doit pas interrompre toute la campagne.
    }
  }

  return { exported, conflicts };
}

/** Répercute vers Google les suppressions faites dans MyFamily. */
async function processDeletions(
  admin: SupabaseClient<Database>,
  client: GoogleCalendarClient,
  calendar: GoogleCalendarRow,
): Promise<number> {
  const { data: pending } = await admin
    .from('google_deletion_queue')
    .select('*')
    .eq('google_calendar_ref', calendar.id)
    .is('processed_at', null)
    .limit(100);

  let deleted = 0;

  for (const item of pending ?? []) {
    // On ne supprime chez Google que ce que MyFamily y avait créé.
    if (item.origin !== 'tribu') {
      await admin
        .from('google_deletion_queue')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', item.id);
      continue;
    }

    try {
      await client.deleteEvent(calendar.google_calendar_id, item.google_event_id);
      await admin
        .from('google_deletion_queue')
        .update({ processed_at: new Date().toISOString(), error_message: null })
        .eq('id', item.id);
      deleted += 1;
    } catch (error) {
      await admin
        .from('google_deletion_queue')
        .update({
          error_message: error instanceof Error ? error.message.slice(0, 400) : 'Échec',
        })
        .eq('id', item.id);
    }
  }

  return deleted;
}

/* -------------------------------------------------------------------------- */
/* Campagne complète                                                          */
/* -------------------------------------------------------------------------- */

export async function syncCalendar(
  admin: SupabaseClient<Database>,
  client: GoogleCalendarClient,
  calendar: GoogleCalendarRow,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    calendarId: calendar.id,
    calendarName: calendar.summary ?? calendar.google_calendar_id,
    imported: 0,
    updated: 0,
    exported: 0,
    deleted: 0,
    conflicts: 0,
    status: 'succes',
  };

  const { data: run } = await admin
    .from('google_sync_runs')
    .insert({
      household_id: calendar.household_id,
      google_calendar_ref: calendar.id,
      direction: 'complet',
      status: 'en_cours',
    })
    .select('id')
    .single();

  try {
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - INITIAL_WINDOW_PAST_DAYS);
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + INITIAL_WINDOW_FUTURE_DAYS);

    let page: Awaited<ReturnType<GoogleCalendarClient['listEvents']>>;

    try {
      page = await client.listEvents(calendar.google_calendar_id, {
        syncToken: calendar.sync_token,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof GoogleSyncTokenExpired)) throw error;
      // Contrat officiel : sur 410, on repart d'une synchronisation complète
      // sans jeton. Rien n'est effacé localement — les correspondances
      // existantes suffisent à retrouver chaque événement sans doublon.
      await admin
        .from('google_calendars')
        .update({ sync_token: null })
        .eq('id', calendar.id);

      page = await client.listEvents(calendar.google_calendar_id, {
        syncToken: null,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
      });
    }

    const counters: ImportCounters = { imported: 0, updated: 0, deleted: 0 };

    // Les séries d'abord : une occurrence modifiée a besoin que sa série
    // existe déjà pour s'y rattacher.
    const series = page.events.filter((e) => !e.recurringEventId);
    const instances = page.events.filter((e) => Boolean(e.recurringEventId));

    for (const remote of [...series, ...instances]) {
      // Événement que MyFamily a créé et qui nous revient : traité comme les
      // autres, l'etag décidera s'il s'agit d'un écho ou d'une vraie
      // modification faite depuis Google.
      isTribuOrigin(remote);
      await applyRemoteEvent(admin, calendar, remote, counters);
    }

    outcome.imported = counters.imported;
    outcome.updated = counters.updated;
    outcome.deleted = counters.deleted;

    if (page.nextSyncToken) {
      await admin
        .from('google_calendars')
        .update({
          sync_token: page.nextSyncToken,
          last_sync_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', calendar.id);
    }

    if (calendar.is_write_target && canWrite(calendar.access_role)) {
      const exportResult = await exportLocalEvents(admin, client, calendar);
      outcome.exported = exportResult.exported;
      outcome.conflicts = exportResult.conflicts;
      outcome.deleted += await processDeletions(admin, client, calendar);
    }

    await admin
      .from('google_sync_runs')
      .update({
        status: 'succes',
        imported_count: outcome.imported,
        updated_count: outcome.updated,
        exported_count: outcome.exported,
        deleted_count: outcome.deleted,
        finished_at: new Date().toISOString(),
      })
      .eq('id', run?.id ?? '');

    return outcome;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Erreur inconnue pendant la synchronisation.';

    outcome.status = 'echec';
    outcome.error = message;

    await admin
      .from('google_calendars')
      .update({ last_error: message.slice(0, 500), last_sync_at: new Date().toISOString() })
      .eq('id', calendar.id);

    await admin
      .from('google_sync_runs')
      .update({
        status: 'echec',
        error_message: message.slice(0, 500),
        finished_at: new Date().toISOString(),
      })
      .eq('id', run?.id ?? '');

    return outcome;
  }
}
