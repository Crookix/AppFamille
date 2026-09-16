import 'server-only';

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, GoogleCalendarRow, GoogleWatchChannelRow } from '@/lib/database.types';
import type { GoogleCalendarClient } from '@/lib/google/client';
import { WATCH_TTL_SECONDS } from '@/lib/google/schedule';

/**
 * Canaux de notification Google Agenda.
 *
 * Le principe : plutôt que de repasser demander à Google s'il s'est passé
 * quelque chose, on lui demande une fois de nous prévenir. Google appelle
 * alors `/api/google/notifications` à chaque changement, et la synchronisation
 * part dans la seconde. C'est le seul déclencheur qui ne dépende ni d'une
 * cadence, ni de quelqu'un qui regarde.
 *
 * Deux contraintes gouvernent ce fichier, et aucune n'est négociable :
 *
 * 1. **L'adresse doit être publique et en HTTPS.** Google la vérifie avant
 *    d'ouvrir le canal, et son domaine doit de surcroît être validé dans la
 *    console Google Cloud. En développement local, rien de tout cela n'est
 *    possible : on le dit, on ne fait pas semblant.
 *
 * 2. **Une notification entrante n'est pas digne de confiance par défaut.**
 *    L'URL est publique, n'importe qui peut la connaître. Chaque canal porte
 *    donc un jeton de vérification dont seul le condensat est stocké, comparé
 *    en temps constant à l'arrivée — même patron que les invitations.
 */

/** En-têtes que Google pose sur chaque notification. */
export const GOOGLE_CHANNEL_ID_HEADER = 'x-goog-channel-id';
export const GOOGLE_CHANNEL_TOKEN_HEADER = 'x-goog-channel-token';
export const GOOGLE_RESOURCE_ID_HEADER = 'x-goog-resource-id';
export const GOOGLE_RESOURCE_STATE_HEADER = 'x-goog-resource-state';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * L'adresse que Google appellera, ou `null` si l'installation ne s'y prête pas.
 *
 * Google refuse `http`, refuse `localhost` et refuse une adresse IP. Retourner
 * `null` plutôt que de tenter l'inscription évite une erreur incompréhensible
 * — « Invalid notification channel address » — là où la cause est simplement
 * qu'on développe sur son poste.
 */
export function pushCallbackUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) return null;
  // Une adresse IP nue n'a pas de domaine vérifiable : Google la refusera.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) return null;

  return `${url.origin}/api/google/notifications`;
}

/** Les notifications push sont-elles possibles sur cette installation ? */
export function isPushSupported(): boolean {
  return pushCallbackUrl() !== null;
}

export type WatchResult =
  | { ok: true; channel: GoogleWatchChannelRow }
  | { ok: false; error: string };

/**
 * Inscrit (ou réinscrit) un calendrier aux notifications.
 *
 * Un canal existant est d'abord fermé : en laisser deux ouverts ferait
 * arriver chaque changement en double sans rien apporter, et le second
 * survivrait à la fermeture du premier puisque Google ne les relie pas.
 */
export async function registerWatchChannel(
  admin: SupabaseClient<Database>,
  client: GoogleCalendarClient,
  calendar: GoogleCalendarRow,
): Promise<WatchResult> {
  const address = pushCallbackUrl();
  if (!address) {
    return {
      ok: false,
      error:
        "Les notifications Google demandent une adresse publique en HTTPS. NEXT_PUBLIC_SITE_URL n'en est pas une : la synchronisation restera périodique.",
    };
  }

  await stopWatchChannel(admin, client, calendar.id);

  const channelId = randomUUID();
  const token = randomBytes(32).toString('base64url');

  try {
    const { resourceId, expiration } = await client.watchEvents(
      calendar.google_calendar_id,
      { channelId, address, token, ttlSeconds: WATCH_TTL_SECONDS },
    );

    const { data, error } = await admin
      .from('google_watch_channels')
      .insert({
        household_id: calendar.household_id,
        google_calendar_ref: calendar.id,
        channel_id: channelId,
        resource_id: resourceId,
        token_hash: hashToken(token),
        expires_at: expiration,
        last_error: null,
      })
      .select('*')
      .single();

    if (error || !data) {
      // Le canal existe chez Google mais pas chez nous : on le referme, sans
      // quoi il enverrait des notifications que personne ne saurait lire.
      await client.stopChannel(channelId, resourceId);
      return {
        ok: false,
        error: "Le canal de notification n'a pas pu être enregistré.",
      };
    }

    return { ok: true, channel: data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Google a refusé d'ouvrir le canal de notification.",
    };
  }
}

/**
 * Ferme le canal d'un calendrier, chez Google puis chez nous.
 *
 * L'ordre compte : si Google refuse, la ligne reste, et le prochain passage
 * réessaiera. L'inverse laisserait un canal orphelin, impossible à fermer
 * faute d'avoir gardé son identifiant de ressource.
 */
export async function stopWatchChannel(
  admin: SupabaseClient<Database>,
  client: GoogleCalendarClient,
  calendarRef: string,
): Promise<void> {
  const { data: channel } = await admin
    .from('google_watch_channels')
    .select('*')
    .eq('google_calendar_ref', calendarRef)
    .maybeSingle();

  if (!channel) return;

  try {
    await client.stopChannel(channel.channel_id, channel.resource_id);
  } catch {
    // Un canal qu'on n'arrive pas à fermer expirera de lui-même. Garder la
    // ligne en base ferait croire aux notifications alors qu'on vient de
    // renoncer au calendrier : on la retire quand même.
  }

  await admin.from('google_watch_channels').delete().eq('id', channel.id);
}

/**
 * Vérifie une notification entrante.
 *
 * Renvoie le canal si, et seulement si, l'identifiant, le jeton et la
 * ressource concordent tous les trois. Un seul écart et la notification est
 * traitée comme si elle ne venait pas de Google — parce qu'elle pourrait ne
 * pas en venir.
 */
export async function verifyNotification(
  admin: SupabaseClient<Database>,
  received: { channelId: string | null; token: string | null; resourceId: string | null },
): Promise<GoogleWatchChannelRow | null> {
  if (!received.channelId || !received.token) return null;

  const { data: channel } = await admin
    .from('google_watch_channels')
    .select('*')
    .eq('channel_id', received.channelId)
    .maybeSingle();

  if (!channel) return null;

  const expected = Buffer.from(channel.token_hash);
  const actual = Buffer.from(hashToken(received.token));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  // Google renvoie toujours l'identifiant de ressource ; s'il diffère, c'est
  // que le canal n'observe plus ce qu'on croit.
  if (received.resourceId && received.resourceId !== channel.resource_id) return null;

  return channel;
}
