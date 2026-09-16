import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GoogleCalendarClient } from '@/lib/google/client';
import { googleSyncReadiness, isSyncInFlight, syncCalendars, totalsOf } from '@/lib/google/run';
import {
  GOOGLE_CHANNEL_ID_HEADER,
  GOOGLE_CHANNEL_TOKEN_HEADER,
  GOOGLE_RESOURCE_ID_HEADER,
  GOOGLE_RESOURCE_STATE_HEADER,
  stopWatchChannel,
  verifyNotification,
} from '@/lib/google/watch';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Google frappe ici quand un calendrier observé change.
 *
 * C'est la seule route de l'application qu'un service extérieur appelle sans
 * session, et son adresse est publique par construction — Google doit pouvoir
 * l'atteindre. Elle ne fait donc confiance à rien de ce qu'elle reçoit tant
 * que trois choses ne concordent pas : l'identifiant du canal, le condensat du
 * jeton de vérification, et l'identifiant de ressource.
 *
 * Aucun en-tête n'est journalisé : le jeton de vérification en fait partie.
 *
 * Google attend un accusé rapide et **réessaie** s'il ne l'obtient pas. Une
 * campagne un peu longue peut donc recevoir une deuxième notification pendant
 * qu'elle travaille : c'est `isSyncInFlight` qui l'absorbe, sans quoi deux
 * campagnes se disputeraient le même jeton de synchronisation.
 */
export async function POST(request: NextRequest) {
  const state = request.headers.get(GOOGLE_RESOURCE_STATE_HEADER);

  // Poignée de main envoyée à l'ouverture du canal : elle ne signale aucun
  // changement, elle prouve seulement que l'adresse répond.
  if (state === 'sync') {
    return new NextResponse(null, { status: 200 });
  }

  const readiness = googleSyncReadiness();
  if (!readiness.ok) {
    // On ne peut ni vérifier ni synchroniser. Répondre 200 ferait croire à
    // Google que la notification a été traitée, et le changement serait perdu
    // sans que personne ne le sache.
    return NextResponse.json({ error: readiness.error }, { status: 503 });
  }

  const admin = createAdminClient();

  const channel = await verifyNotification(admin, {
    channelId: request.headers.get(GOOGLE_CHANNEL_ID_HEADER),
    token: request.headers.get(GOOGLE_CHANNEL_TOKEN_HEADER),
    resourceId: request.headers.get(GOOGLE_RESOURCE_ID_HEADER),
  });

  if (!channel) {
    // Canal inconnu ou jeton qui ne correspond pas. Le 404 fait cesser les
    // envois côté Google au lieu de les faire réessayer indéfiniment.
    return NextResponse.json({ error: 'Canal inconnu.' }, { status: 404 });
  }

  await admin
    .from('google_watch_channels')
    .update({ last_notified_at: new Date().toISOString(), last_error: null })
    .eq('id', channel.id);

  const { data: calendar } = await admin
    .from('google_calendars')
    .select('*')
    .eq('id', channel.google_calendar_ref)
    .maybeSingle();

  if (!calendar) {
    return NextResponse.json({ ok: true, ignored: 'calendrier absent' });
  }

  // Le calendrier a été décoché entre-temps : on referme le canal plutôt que
  // de continuer à recevoir des notifications dont on ne fera rien.
  if (!calendar.is_selected) {
    const client = new GoogleCalendarClient(admin, calendar.google_account_id);
    await stopWatchChannel(admin, client, calendar.id);
    return NextResponse.json({ ok: true, ignored: 'calendrier non sélectionné' });
  }

  if (await isSyncInFlight(admin, calendar.id)) {
    return NextResponse.json({ ok: true, skipped: 'campagne déjà en cours' });
  }

  const outcomes = await syncCalendars(admin, [calendar]);
  const failed = outcomes.filter((o) => o.status === 'echec');

  return NextResponse.json(
    { ok: failed.length === 0, totals: totalsOf(outcomes) },
    // Un échec renvoyé en 500 fait réessayer Google, ce qui est exactement ce
    // qu'on veut quand la cause est passagère.
    { status: failed.length > 0 ? 500 : 200 },
  );
}
