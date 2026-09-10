import { NextResponse } from 'next/server';
import { getActiveHousehold, getUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isEncryptionConfigured } from '@/lib/google/crypto';
import { isGoogleConfigured } from '@/lib/google/oauth';
import { GoogleCalendarClient } from '@/lib/google/client';
import { syncCalendar, type SyncOutcome } from '@/lib/google/sync';

/** Une campagne peut prendre du temps : on laisse de la marge à la fonction. */
export const maxDuration = 60;

/**
 * Lance une synchronisation des calendriers sélectionnés.
 *
 * Aucune synchronisation n'est simulée : si la configuration manque ou si
 * Google refuse, la réponse le dit explicitement et l'interface affiche
 * l'erreur telle quelle.
 */
export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });
  }

  const active = await getActiveHousehold();
  if (!active) {
    return NextResponse.json({ error: 'Aucun foyer actif.' }, { status: 400 });
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google Agenda n'est pas configuré sur cette installation (GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET manquants). Voir docs/GOOGLE.md.",
      },
      { status: 503 },
    );
  }

  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      {
        error:
          "TOKEN_ENCRYPTION_KEY est absente ou invalide : les jetons Google ne peuvent pas être lus en sécurité.",
      },
      { status: 503 },
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY est absente : la synchronisation ne peut pas accéder aux jetons chiffrés.",
      },
      { status: 503 },
    );
  }

  const supabase = await createClient();

  const { data: account } = await supabase
    .from('google_accounts')
    .select('id, calendar_authorized')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account || !account.calendar_authorized) {
    return NextResponse.json(
      { error: "Aucun agenda Google autorisé pour ce compte." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: calendars } = await admin
    .from('google_calendars')
    .select('*')
    .eq('google_account_id', account.id)
    .eq('household_id', active.household.id)
    .eq('is_selected', true);

  if (!calendars || calendars.length === 0) {
    return NextResponse.json(
      { error: "Aucun calendrier sélectionné. Choisissez au moins un calendrier." },
      { status: 400 },
    );
  }

  const client = new GoogleCalendarClient(admin, account.id);
  const outcomes: SyncOutcome[] = [];

  for (const calendar of calendars) {
    outcomes.push(await syncCalendar(admin, client, calendar));
  }

  const failed = outcomes.filter((o) => o.status === 'echec');

  return NextResponse.json(
    {
      ok: failed.length === 0,
      outcomes,
      totals: {
        imported: outcomes.reduce((sum, o) => sum + o.imported, 0),
        updated: outcomes.reduce((sum, o) => sum + o.updated, 0),
        exported: outcomes.reduce((sum, o) => sum + o.exported, 0),
        deleted: outcomes.reduce((sum, o) => sum + o.deleted, 0),
        conflicts: outcomes.reduce((sum, o) => sum + o.conflicts, 0),
      },
    },
    { status: failed.length === outcomes.length && failed.length > 0 ? 502 : 200 },
  );
}
