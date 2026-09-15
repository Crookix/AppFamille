import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { GoogleCalendarRow } from '@/lib/database.types';
import { GoogleCalendarClient } from '@/lib/google/client';
import { googleSyncReadiness, syncCalendars, totalsOf } from '@/lib/google/run';
import {
  CRON_TIME_BUDGET_MS,
  needsChannelRenewal,
  selectCalendarsForCron,
} from '@/lib/google/schedule';
import { isPushSupported, registerWatchChannel } from '@/lib/google/watch';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Le filet : un passage régulier sur tous les foyers connectés.
 *
 * Les notifications de Google font l'essentiel du travail et vont plus vite,
 * mais elles ne couvrent pas tout — un canal expire, une notification se
 * perd, un déploiement passe pendant qu'un changement arrive. Le cron rattrape
 * ces cas-là, et c'est aussi lui qui renouvelle les canaux avant échéance.
 *
 * Il est déclaré dans `vercel.json` et appelé par Vercel, qui présente
 * `CRON_SECRET` en en-tête d'autorisation. Cette route n'est donc pas
 * publique : sans le secret, elle refuse — et **sans secret configuré, elle
 * refuse aussi**, plutôt que de s'ouvrir à qui connaît son adresse.
 */

/** Nombre maximum d'inscriptions ou de renouvellements par passage. */
const WATCH_BUDGET = 10;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const received = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET n'est pas configurée : la synchronisation programmée reste désactivée pour ne pas exposer une route ouverte.",
      },
      { status: 503 },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json({ error: 'Appel non autorisé.' }, { status: 401 });
  }

  const readiness = googleSyncReadiness();
  if (!readiness.ok) {
    return NextResponse.json({ error: readiness.error }, { status: 503 });
  }

  const deadline = Date.now() + CRON_TIME_BUDGET_MS;
  const admin = createAdminClient();

  // Deux lectures indépendantes, donc une seule vague. Le croisement se fait
  // en mémoire : un foyer compte quelques calendriers, pas des milliers, et
  // une jointure imbriquée PostgREST ne se laisse pas typer ici.
  const [accountsResult, calendarsResult, channelsResult] = await Promise.all([
    admin
      .from('google_accounts')
      .select('id')
      .eq('calendar_authorized', true)
      .is('revoked_at', null),
    admin.from('google_calendars').select('*').eq('is_selected', true),
    admin.from('google_watch_channels').select('*'),
  ]);

  const authorizedAccounts = new Set((accountsResult.data ?? []).map((a) => a.id));
  const calendars = (calendarsResult.data ?? []).filter((calendar) =>
    authorizedAccounts.has(calendar.google_account_id),
  );

  const channelByCalendar = new Map(
    (channelsResult.data ?? []).map((channel) => [channel.google_calendar_ref, channel]),
  );

  const now = new Date();
  const due = selectCalendarsForCron(calendars, { now });

  /* --- Canaux de notification ---------------------------------------- */

  let watched = 0;
  const watchErrors: string[] = [];

  if (isPushSupported()) {
    // Deux populations : les canaux qui approchent de leur échéance, à
    // renouveler quoi qu'il arrive, et les calendriers qui n'en ont aucun.
    // Ces derniers ne sont tentés que parmi ceux qu'on s'apprête déjà à
    // synchroniser : si Google refuse — domaine non vérifié, typiquement —
    // on ne veut pas réessayer pour chaque calendrier à chaque passage.
    const toRenew = calendars.filter((calendar) => {
      const channel = channelByCalendar.get(calendar.id);
      return channel !== undefined && needsChannelRenewal(channel.expires_at, now);
    });
    const toCreate = due.filter((calendar) => !channelByCalendar.has(calendar.id));

    const targets: GoogleCalendarRow[] = [...toRenew, ...toCreate].slice(0, WATCH_BUDGET);

    // Un client par compte, pas un par calendrier : chaque construction relit
    // les jetons chiffrés en base.
    const clients = new Map<string, GoogleCalendarClient>();
    const clientFor = (accountId: string) => {
      const existing = clients.get(accountId);
      if (existing) return existing;
      const created = new GoogleCalendarClient(admin, accountId);
      clients.set(accountId, created);
      return created;
    };

    for (const calendar of targets) {
      if (Date.now() > deadline) break;

      const result = await registerWatchChannel(
        admin,
        clientFor(calendar.google_account_id),
        calendar,
      );

      if (result.ok) {
        watched += 1;
        continue;
      }

      watchErrors.push(result.error);
      // Le compte porte déjà l'affichage des pannes Google : c'est là que
      // l'utilisateur ira voir pourquoi son agenda ne se met plus à jour.
      await admin
        .from('google_accounts')
        .update({ last_error: `Notifications Google : ${result.error.slice(0, 380)}` })
        .eq('id', calendar.google_account_id);
    }
  }

  /* --- Synchronisation ------------------------------------------------ */

  const outcomes = await syncCalendars(admin, due, { deadline });
  const failed = outcomes.filter((o) => o.status === 'echec');

  return NextResponse.json({
    ok: failed.length === 0,
    calendars: { eligible: calendars.length, selected: due.length, synced: outcomes.length },
    watch: { supported: isPushSupported(), renewed: watched, errors: watchErrors.length },
    totals: totalsOf(outcomes),
    // Le nom du calendrier, et rien de plus : cette réponse finit dans les
    // journaux de Vercel, et un message d'erreur Google peut transporter le
    // corps de sa réponse. La cause complète est enregistrée sur le
    // calendrier, où l'écran Google Agenda l'affiche à qui a le droit de la
    // lire.
    failed: failed.map((o) => o.calendarName),
  });
}
