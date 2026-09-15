'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';
import type { GoogleShareMode } from '@/lib/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { GoogleCalendarClient } from '@/lib/google/client';
import { googleSyncReadiness } from '@/lib/google/run';
import { isPushSupported, registerWatchChannel, stopWatchChannel } from '@/lib/google/watch';

const calendarSchema = z.object({
  calendarId: z.string().uuid('Calendrier inconnu.'),
  isSelected: z.boolean().optional(),
  shareMode: z.enum(['details', 'disponibilite']).optional(),
  isWriteTarget: z.boolean().optional(),
});

/**
 * Règle un calendrier Google : synchronisé ou non, détails ou disponibilité,
 * cible des créations.
 *
 * Le réglage passait autrefois par le navigateur, directement dans la table.
 * C'était une écriture hors Server Action, et surtout un client sans jeton dès
 * que Clerk tient la session : la RLS ne refusait rien, elle ne touchait
 * simplement aucune ligne, et la case revenait à sa place sans un mot.
 *
 * L'appartenance est vérifiée deux fois : le calendrier doit être rangé dans le
 * foyer actif, et la politique RLS exige en plus que le compte Google visé soit
 * celui de la personne connectée — on ne configure pas l'agenda d'un autre.
 */
export async function updateGoogleCalendarAction(input: z.input<typeof calendarSchema>) {
  const parsed = calendarSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household } = active.data;
  const { calendarId, isSelected, shareMode, isWriteTarget } = parsed.data;

  const { data: calendar } = await supabase
    .from('google_calendars')
    .select('id, google_account_id')
    .eq('id', calendarId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!calendar) return fail('Ce calendrier ne fait pas partie de votre foyer.');

  const patch: {
    is_selected?: boolean;
    share_mode?: GoogleShareMode;
    is_write_target?: boolean;
  } = {};
  if (isSelected !== undefined) patch.is_selected = isSelected;
  if (shareMode !== undefined) patch.share_mode = shareMode;
  if (isWriteTarget !== undefined) patch.is_write_target = isWriteTarget;

  if (Object.keys(patch).length === 0) return ok();

  // Un seul calendrier peut recevoir les créations : la base l'impose par un
  // index unique, on lève donc l'ancien avant de poser le nouveau.
  if (isWriteTarget) {
    const { error: clearError } = await supabase
      .from('google_calendars')
      .update({ is_write_target: false })
      .eq('google_account_id', calendar.google_account_id)
      .eq('is_write_target', true);

    if (clearError) return fail(humanizeDbError(clearError));
  }

  const { error } = await supabase
    .from('google_calendars')
    .update(patch)
    .eq('id', calendarId)
    .eq('household_id', household.id);

  if (error) return fail(humanizeDbError(error));

  if (isSelected !== undefined) {
    await syncWatchChannel(calendarId, household.id, isSelected);
  }

  revalidatePath('/plus/google');
  return ok();
}

/**
 * Aligne le canal de notification sur la case qui vient d'être cochée.
 *
 * Cocher un calendrier, c'est demander à le voir à jour ; c'est donc ici que
 * Google est prié de nous prévenir quand il change, et ici qu'on lui demande
 * d'arrêter quand la case est décochée. Attendre le passage du cron
 * marcherait, mais ferait vivre un quart d'heure d'agenda muet juste après le
 * geste censé l'allumer.
 *
 * Le client à privilèges élevés est indispensable : les jetons Google vivent
 * dans `google_credentials`, table sans aucune politique, et la table des
 * canaux n'accepte aucune écriture depuis `authenticated`. L'appartenance au
 * foyer a été vérifiée juste au-dessus, et le calendrier relu ici est celui du
 * foyer actif — pas celui qu'un identifiant envoyé à la main désignerait.
 *
 * Une inscription qui échoue ne fait PAS échouer la sélection : la case est
 * bien cochée, le calendrier sera bien synchronisé par le cron. L'erreur est
 * portée sur le compte Google, là où l'écran l'affiche déjà.
 */
async function syncWatchChannel(
  calendarId: string,
  householdId: string,
  selected: boolean,
): Promise<void> {
  if (!googleSyncReadiness().ok) return;
  if (selected && !isPushSupported()) return;

  try {
    const admin = createAdminClient();

    const { data: calendar } = await admin
      .from('google_calendars')
      .select('*')
      .eq('id', calendarId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (!calendar) return;

    const client = new GoogleCalendarClient(admin, calendar.google_account_id);

    if (!selected) {
      await stopWatchChannel(admin, client, calendar.id);
      return;
    }

    const result = await registerWatchChannel(admin, client, calendar);
    if (!result.ok) {
      await admin
        .from('google_accounts')
        .update({ last_error: `Notifications Google : ${result.error.slice(0, 380)}` })
        .eq('id', calendar.google_account_id);
    }
  } catch {
    // Le réglage demandé a été enregistré ; l'automatisation se rattrapera au
    // prochain passage du cron. Rien ne doit laisser croire l'inverse, et
    // rien ne doit non plus faire échouer un réglage qui, lui, a réussi.
  }
}
