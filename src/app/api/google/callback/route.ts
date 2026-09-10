import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getActiveHousehold, getUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptToken, isEncryptionConfigured } from '@/lib/google/crypto';
import {
  decodeIdToken,
  exchangeCode,
  GOOGLE_CALENDAR_SCOPES,
  isGoogleConfigured,
  STATE_COOKIE,
  statesMatch,
} from '@/lib/google/oauth';
import { GoogleCalendarClient } from '@/lib/google/client';
import { canWrite } from '@/lib/google/mapping';

/**
 * Retour d'autorisation Google Agenda.
 *
 * Vérifie le jeton d'état, échange le code, chiffre les jetons, puis énumère
 * les calendriers auxquels l'utilisateur est abonné — sans en activer aucun.
 * La sélection est un choix explicite, fait ensuite dans l'interface.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const settings = new URL('/plus/google', origin);

  const fail = (code: string) => {
    settings.searchParams.set('erreur', code);
    return NextResponse.redirect(settings);
  };

  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/connexion?suite=/plus/google', origin));

  const active = await getActiveHousehold();
  if (!active) return fail('aucun_foyer');

  if (!isGoogleConfigured()) return fail('non_configure');
  if (!isEncryptionConfigured()) return fail('cle_chiffrement');

  // L'utilisateur a refusé, ou Google a rejeté la demande.
  if (searchParams.get('error')) return fail('refus');

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code || !state) return fail('reponse_incomplete');

  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!expected || !statesMatch(state, expected)) return fail('etat_invalide');

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch {
    return fail('echange_refuse');
  }

  // Sans jeton de rafraîchissement, l'autorisation expirerait dans l'heure.
  // Mieux vaut le dire tout de suite que laisser une synchronisation mourir
  // silencieusement demain.
  const grantedScopes = (tokens.scope ?? '').split(' ');
  const calendarAuthorized = GOOGLE_CALENDAR_SCOPES.filter(
    (scope) => scope.startsWith('https://'),
  ).every((scope) => grantedScopes.includes(scope));

  if (!calendarAuthorized) return fail('portee_refusee');

  const identity = tokens.id_token ? decodeIdToken(tokens.id_token) : {};
  if (!identity.sub) return fail('identite_absente');

  const admin = createAdminClient();

  const { data: account, error: accountError } = await admin
    .from('google_accounts')
    .upsert(
      {
        user_id: user.id,
        google_sub: identity.sub,
        email: identity.email ?? null,
        scopes: grantedScopes,
        calendar_authorized: true,
        connected_at: new Date().toISOString(),
        last_error: null,
        revoked_at: null,
      },
      { onConflict: 'user_id,google_sub' },
    )
    .select('id')
    .single();

  if (accountError || !account) return fail('enregistrement');

  await admin.from('google_credentials').upsert(
    {
      google_account_id: account.id,
      access_token_enc: encryptToken(tokens.access_token),
      ...(tokens.refresh_token
        ? { refresh_token_enc: encryptToken(tokens.refresh_token) }
        : {}),
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    },
    { onConflict: 'google_account_id' },
  );

  // Énumération des calendriers, sans en activer aucun.
  try {
    const client = new GoogleCalendarClient(admin, account.id);
    const calendars = await client.listCalendars();

    for (const calendar of calendars) {
      await admin.from('google_calendars').upsert(
        {
          google_account_id: account.id,
          household_id: active.household.id,
          google_calendar_id: calendar.id,
          summary: calendar.summary ?? null,
          description: calendar.description ?? null,
          time_zone: calendar.timeZone ?? null,
          background_color: calendar.backgroundColor ?? null,
          access_role: calendar.accessRole ?? null,
          is_primary: calendar.primary ?? false,
        },
        { onConflict: 'google_account_id,google_calendar_id' },
      );
    }

    // Aucun calendrier accessible en écriture n'est désigné d'office :
    // écrire dans l'agenda de quelqu'un demande un accord explicite.
    void canWrite;
  } catch (error) {
    await admin
      .from('google_accounts')
      .update({
        last_error:
          error instanceof Error
            ? error.message.slice(0, 400)
            : 'Les calendriers n’ont pas pu être listés.',
      })
      .eq('id', account.id);

    settings.searchParams.set('erreur', 'liste_calendriers');
    return NextResponse.redirect(settings);
  }

  settings.searchParams.set('connecte', '1');
  return NextResponse.redirect(settings);
}
