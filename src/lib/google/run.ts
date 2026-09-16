import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, GoogleCalendarRow } from '@/lib/database.types';
import { GoogleCalendarClient } from '@/lib/google/client';
import { isEncryptionConfigured } from '@/lib/google/crypto';
import { isGoogleConfigured } from '@/lib/google/oauth';
import { syncCalendar, type SyncOutcome } from '@/lib/google/sync';

/**
 * Ce que partagent les quatre façons de lancer une synchronisation.
 *
 * Il y en a désormais quatre : le bouton « Synchroniser », l'ouverture de
 * l'écran Calendrier, le passage régulier du cron, et la notification envoyée
 * par Google quand un calendrier bouge. Trois d'entre elles n'ont pas
 * d'utilisateur connecté en face — ni session, ni foyer actif, ni cookie.
 *
 * Tout ce qui ne dépend pas de cette session vit donc ici : les contrôles de
 * configuration, le groupement par compte Google, les totaux. Les routes ne
 * gardent que ce qui leur est propre — qui a le droit de déclencher, et ce
 * qu'on répond.
 */

export type SyncTotals = {
  imported: number;
  updated: number;
  exported: number;
  deleted: number;
  conflicts: number;
};

export const EMPTY_TOTALS: SyncTotals = {
  imported: 0,
  updated: 0,
  exported: 0,
  deleted: 0,
  conflicts: 0,
};

export function totalsOf(outcomes: SyncOutcome[]): SyncTotals {
  return outcomes.reduce<SyncTotals>(
    (sum, outcome) => ({
      imported: sum.imported + outcome.imported,
      updated: sum.updated + outcome.updated,
      exported: sum.exported + outcome.exported,
      deleted: sum.deleted + outcome.deleted,
      conflicts: sum.conflicts + outcome.conflicts,
    }),
    { ...EMPTY_TOTALS },
  );
}

/** Quelque chose a-t-il réellement bougé ? Sert à ne rafraîchir qu'à bon escient. */
export function hasChanges(totals: SyncTotals): boolean {
  return (
    totals.imported > 0 ||
    totals.updated > 0 ||
    totals.exported > 0 ||
    totals.deleted > 0
  );
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export type Readiness = { ok: true } | { ok: false; error: string };

/**
 * L'installation peut-elle synchroniser ?
 *
 * Une configuration absente se dit — elle ne se devine pas au bout de trois
 * jours sans nouvel événement. Le message nomme la variable manquante, parce
 * que c'est la seule information qui permette de corriger.
 */
export function googleSyncReadiness(): Readiness {
  if (!isGoogleConfigured()) {
    return {
      ok: false,
      error:
        "Google Agenda n'est pas configuré sur cette installation (GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET manquants). Voir docs/GOOGLE.md.",
    };
  }

  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error:
        'TOKEN_ENCRYPTION_KEY est absente ou invalide : les jetons Google ne peuvent pas être lus en sécurité.',
    };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      error:
        "SUPABASE_SERVICE_ROLE_KEY est absente : la synchronisation ne peut pas accéder aux jetons chiffrés.",
    };
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Exécution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Synchronise une liste de calendriers, quel que soit le compte dont ils
 * viennent.
 *
 * Les calendriers sont groupés par compte Google parce qu'un client porte un
 * jeton d'accès, et qu'un jeton vaut pour un compte : construire un client par
 * calendrier referait le même rafraîchissement autant de fois qu'il y a de
 * calendriers.
 *
 * `deadline` borne l'ensemble. Une fonction serverless est interrompue sans
 * préavis à l'expiration de son temps : mieux vaut s'arrêter soi-même entre
 * deux calendriers, en laissant chacun cohérent, que d'être coupé au milieu
 * d'une campagne.
 *
 * Un calendrier déjà en cours de campagne est **sauté**. Quatre déclencheurs
 * peuvent partir en même temps, et Vercel avertit qu'une exécution programmée
 * est parfois invoquée deux fois. Deux campagnes simultanées sur le même
 * calendrier ne se contentent pas de gaspiller : elles lisent la même page
 * d'événements avant que l'une n'ait écrit sa correspondance, insèrent chacune
 * l'événement, et **un seul des deux liens passe** — l'index unique refuse le
 * second. L'événement orphelin, lui, reste : un doublon visible dans le
 * calendrier du foyer, exactement ce que ce module promet d'empêcher.
 */
export async function syncCalendars(
  admin: SupabaseClient<Database>,
  calendars: GoogleCalendarRow[],
  options: { deadline?: number } = {},
): Promise<SyncOutcome[]> {
  const byAccount = new Map<string, GoogleCalendarRow[]>();
  for (const calendar of calendars) {
    const list = byAccount.get(calendar.google_account_id) ?? [];
    list.push(calendar);
    byAccount.set(calendar.google_account_id, list);
  }

  const outcomes: SyncOutcome[] = [];

  for (const [accountId, accountCalendars] of byAccount) {
    const client = new GoogleCalendarClient(admin, accountId);

    for (const calendar of accountCalendars) {
      if (options.deadline !== undefined && Date.now() > options.deadline) {
        return outcomes;
      }
      if (await isSyncInFlight(admin, calendar.id)) continue;

      outcomes.push(await syncCalendar(admin, client, calendar));
    }
  }

  return outcomes;
}

/* -------------------------------------------------------------------------- */
/* Garde contre les campagnes simultanées                                     */
/* -------------------------------------------------------------------------- */

/** Au-delà, une campagne « en cours » est tenue pour abandonnée. */
const IN_FLIGHT_TIMEOUT_MS = 2 * 60_000;

/**
 * Une campagne est-elle déjà en route sur ce calendrier ?
 *
 * Google peut envoyer plusieurs notifications en rafale — une modification en
 * lot dans son interface en produit une par événement. Sans cette garde, dix
 * campagnes partiraient de front sur le même calendrier, se disputeraient le
 * même `syncToken` et finiraient par le périmer.
 *
 * La borne de deux minutes est ce qui distingue « une campagne travaille » de
 * « une campagne a été interrompue et a laissé sa ligne en l'état ». Sans
 * elle, un seul plantage suffirait à bloquer un calendrier pour toujours.
 *
 * Ce n'est pas un verrou : deux campagnes qui démarrent à la même
 * milliseconde se verront mutuellement « libres ». C'est assumé. Un vrai
 * verrou en base — un index unique sur les campagnes en cours — fermerait
 * cette fenêtre, mais bloquerait le calendrier pour de bon au premier
 * plantage, faute de savoir qu'une ligne est périmée. On préfère une fenêtre
 * de quelques millisecondes qui se referme seule à un verrou qui demande une
 * intervention.
 */
export async function isSyncInFlight(
  admin: SupabaseClient<Database>,
  calendarRef: string,
): Promise<boolean> {
  const since = new Date(Date.now() - IN_FLIGHT_TIMEOUT_MS).toISOString();

  const { data } = await admin
    .from('google_sync_runs')
    .select('id')
    .eq('google_calendar_ref', calendarRef)
    .eq('status', 'en_cours')
    .gte('started_at', since)
    .limit(1);

  return (data ?? []).length > 0;
}
