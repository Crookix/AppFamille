import { NextResponse, type NextRequest } from 'next/server';
import { getActiveHousehold, getUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptToken } from '@/lib/google/crypto';
import { revokeToken } from '@/lib/google/oauth';
import { GoogleCalendarClient } from '@/lib/google/client';
import { stopWatchChannel } from '@/lib/google/watch';

/**
 * Déconnecte l'agenda Google.
 *
 * Les événements déjà importés RESTENT dans le foyer : ils font partie de son
 * organisation, et les effacer sans le dire serait une perte de données. Seuls
 * les jetons et les correspondances disparaissent. Un second appel, avec
 * `supprimer=1`, retire aussi les événements importés — c'est alors une action
 * explicite de l'utilisateur.
 */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 });
  }

  const active = await getActiveHousehold();
  if (!active) {
    return NextResponse.json({ error: 'Aucun foyer actif.' }, { status: 400 });
  }

  const removeEvents = request.nextUrl.searchParams.get('supprimer') === '1';
  const supabase = await createClient();

  const { data: account } = await supabase
    .from('google_accounts')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ ok: true, message: 'Aucun compte Google relié.' });
  }

  let revoked = false;

  try {
    const admin = createAdminClient();

    const { data: credentials } = await admin
      .from('google_credentials')
      .select('refresh_token_enc, access_token_enc')
      .eq('google_account_id', account.id)
      .maybeSingle();

    // Les canaux de notification se ferment AVANT la révocation : une fois le
    // jeton révoqué, `channels.stop` n'a plus de quoi s'authentifier et les
    // canaux resteraient ouverts jusqu'à leur expiration, à frapper une route
    // qui ne saurait plus quoi en faire.
    const { data: watched } = await admin
      .from('google_calendars')
      .select('id')
      .eq('google_account_id', account.id);

    if ((watched ?? []).length > 0) {
      const client = new GoogleCalendarClient(admin, account.id);
      for (const calendar of watched ?? []) {
        await stopWatchChannel(admin, client, calendar.id);
      }
    }

    const token = credentials?.refresh_token_enc ?? credentials?.access_token_enc;
    if (token) {
      revoked = await revokeToken(decryptToken(token));
    }

    if (removeEvents) {
      // Suppression explicitement demandée : on retire les événements
      // IMPORTÉS uniquement. Ce que le foyer a créé lui appartient.
      const { data: calendars } = await admin
        .from('google_calendars')
        .select('id')
        .eq('google_account_id', account.id);

      const calendarIds = (calendars ?? []).map((c) => c.id);
      if (calendarIds.length > 0) {
        await admin
          .from('events')
          .delete()
          .eq('household_id', active.household.id)
          .eq('origin', 'google')
          .in('google_calendar_ref', calendarIds);
      }
    }

    // La suppression du compte fait tomber en cascade les identifiants, les
    // calendriers et les correspondances.
    await admin.from('google_accounts').delete().eq('id', account.id);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "La déconnexion n'a pas pu être menée à son terme.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    revoked,
    eventsRemoved: removeEvents,
  });
}
