import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { decryptToken, encryptToken } from '@/lib/google/crypto';
import { refreshAccessToken } from '@/lib/google/oauth';
import type { GoogleEvent } from '@/lib/google/mapping';

const API_BASE = 'https://www.googleapis.com/calendar/v3';

/** Marge avant expiration : on rafraîchit sans attendre le refus. */
const REFRESH_MARGIN_MS = 60_000;

export class GoogleAuthError extends Error {}
export class GoogleSyncTokenExpired extends Error {}

/**
 * Client Google Agenda authentifié pour un compte relié.
 *
 * Les jetons ne quittent jamais le serveur : ils sont lus via le rôle
 * `service_role` (seul à pouvoir accéder à `google_credentials`), déchiffrés en
 * mémoire, et le jeton d'accès est rafraîchi automatiquement à l'approche de
 * son expiration.
 */
export class GoogleCalendarClient {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly admin: SupabaseClient<Database>,
    private readonly googleAccountId: string,
  ) {}

  /** Jeton d'accès valide, rafraîchi si nécessaire. */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - REFRESH_MARGIN_MS) {
      return this.accessToken;
    }

    const { data: credentials } = await this.admin
      .from('google_credentials')
      .select('*')
      .eq('google_account_id', this.googleAccountId)
      .maybeSingle();

    if (!credentials) {
      throw new GoogleAuthError(
        "Aucune autorisation Google enregistrée. Reconnectez votre agenda.",
      );
    }

    const stillValid =
      credentials.access_token_enc &&
      credentials.token_expires_at &&
      new Date(credentials.token_expires_at).getTime() > Date.now() + REFRESH_MARGIN_MS;

    if (stillValid) {
      this.accessToken = decryptToken(credentials.access_token_enc!);
      this.expiresAt = new Date(credentials.token_expires_at!).getTime();
      return this.accessToken;
    }

    if (!credentials.refresh_token_enc) {
      throw new GoogleAuthError(
        "L'autorisation Google a expiré et ne peut pas être renouvelée. Reconnectez votre agenda.",
      );
    }

    let refreshed;
    try {
      refreshed = await refreshAccessToken(decryptToken(credentials.refresh_token_enc));
    } catch (error) {
      // On note l'échec sur le compte : l'interface pourra l'afficher au lieu
      // de laisser croire à une synchronisation silencieusement en panne.
      await this.admin
        .from('google_accounts')
        .update({
          last_error:
            error instanceof Error ? error.message : "Renouvellement impossible.",
        })
        .eq('id', this.googleAccountId);

      throw new GoogleAuthError(
        error instanceof Error ? error.message : 'Renouvellement impossible.',
      );
    }

    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

    await this.admin
      .from('google_credentials')
      .update({
        access_token_enc: encryptToken(refreshed.access_token),
        // Google ne renvoie pas toujours un nouveau jeton de rafraîchissement :
        // on conserve alors l'ancien, qui reste valable.
        ...(refreshed.refresh_token
          ? { refresh_token_enc: encryptToken(refreshed.refresh_token) }
          : {}),
        token_expires_at: expiresAt.toISOString(),
      })
      .eq('google_account_id', this.googleAccountId);

    await this.admin
      .from('google_accounts')
      .update({ last_error: null })
      .eq('id', this.googleAccountId);

    this.accessToken = refreshed.access_token;
    this.expiresAt = expiresAt.getTime();
    return this.accessToken;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { query?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    const { query, ...rest } = init;
    const url = new URL(`${API_BASE}${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }

    const token = await this.getAccessToken();

    const response = await fetch(url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(rest.headers ?? {}),
      },
      cache: 'no-store',
    });

    if (response.status === 410) {
      // Documenté : un jeton de synchronisation périmé impose de repartir
      // d'une synchronisation complète, sans syncToken.
      throw new GoogleSyncTokenExpired(
        'Le jeton de synchronisation a expiré ; une synchronisation complète est nécessaire.',
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new GoogleAuthError(
        `Google a refusé l'accès (${response.status}). Vérifiez l'autorisation de l'agenda.`,
      );
    }

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google Agenda a répondu ${response.status} : ${detail.slice(0, 400)}`);
    }

    return response.json();
  }

  /* ------------------------------------------------------------------ */

  async listCalendars(): Promise<
    {
      id: string;
      summary?: string;
      description?: string;
      timeZone?: string;
      backgroundColor?: string;
      accessRole?: string;
      primary?: boolean;
      deleted?: boolean;
    }[]
  > {
    const items: Awaited<ReturnType<GoogleCalendarClient['listCalendars']>> = [];
    let pageToken: string | undefined;

    do {
      const page = await this.request<{
        items?: typeof items;
        nextPageToken?: string;
      }>('/users/me/calendarList', {
        query: { maxResults: '250', pageToken, showDeleted: 'false' },
      });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return items;
  }

  /**
   * Liste les événements modifiés depuis le dernier jeton.
   *
   * Contrat officiel (document de découverte Calendar v3) : avec `syncToken`,
   * il est INTERDIT de passer timeMin, timeMax, updatedMin, q, orderBy,
   * iCalUID ou les propriétés étendues, et `showDeleted` ne peut pas valoir
   * false. Les autres paramètres doivent rester identiques à ceux de la
   * synchronisation initiale, sinon le comportement est indéfini.
   */
  async listEvents(
    calendarId: string,
    options: { syncToken?: string | null; timeMin?: string; timeMax?: string },
  ): Promise<{ events: GoogleEvent[]; nextSyncToken: string | null }> {
    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    do {
      const query: Record<string, string | undefined> = {
        maxResults: '250',
        pageToken,
        // Les séries sont importées telles quelles, avec leur RRULE, et leurs
        // occurrences modifiées arrivent comme événements distincts. C'est
        // exactement le modèle de MyFamily, d'où `singleEvents=false`.
        singleEvents: 'false',
        showDeleted: 'true',
      };

      if (options.syncToken) {
        query.syncToken = options.syncToken;
      } else {
        // Première synchronisation : on borne la fenêtre pour ne pas
        // rapatrier dix ans d'historique.
        query.timeMin = options.timeMin;
        query.timeMax = options.timeMax;
      }

      const page = await this.request<{
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(`/calendars/${encodeURIComponent(calendarId)}/events`, { query });

      events.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
    } while (pageToken);

    return { events, nextSyncToken };
  }

  /**
   * Demande à Google de prévenir MyFamily quand ce calendrier change.
   *
   * `address` doit être une URL **publique en HTTPS** : Google vérifie qu'elle
   * répond avant d'ouvrir le canal, et refuse tout ce qui ressemble à une
   * adresse locale. Le `token` revient tel quel dans chaque notification et
   * sert à prouver qu'elle vient bien de ce canal-ci.
   *
   * `expiration` est renvoyée en millisecondes depuis l'époque, sous forme de
   * chaîne. Google est libre de raccourcir la durée demandée : c'est cette
   * valeur-là qui fait foi, jamais le `ttl` qu'on a proposé.
   */
  async watchEvents(
    calendarId: string,
    options: { channelId: string; address: string; token: string; ttlSeconds: number },
  ): Promise<{ resourceId: string; expiration: string | null }> {
    const response = await this.request<{
      id?: string;
      resourceId?: string;
      expiration?: string;
    }>(`/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
      method: 'POST',
      body: JSON.stringify({
        id: options.channelId,
        type: 'web_hook',
        address: options.address,
        token: options.token,
        params: { ttl: String(options.ttlSeconds) },
      }),
    });

    if (!response.resourceId) {
      throw new Error(
        "Google a ouvert le canal sans renvoyer d'identifiant de ressource : il serait impossible de l'arrêter.",
      );
    }

    const expirationMs = Number(response.expiration);
    return {
      resourceId: response.resourceId,
      expiration: Number.isFinite(expirationMs)
        ? new Date(expirationMs).toISOString()
        : null,
    };
  }

  /**
   * Ferme un canal de notification.
   *
   * Les deux identifiants sont exigés par Google. Un canal qui a déjà expiré
   * ou été fermé répond 404 : le but est atteint, ce n'est pas une erreur.
   */
  async stopChannel(channelId: string, resourceId: string): Promise<void> {
    try {
      await this.request<void>('/channels/stop', {
        method: 'POST',
        body: JSON.stringify({ id: channelId, resourceId }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/\b(404|410)\b/.test(message)) throw error;
    }
  }

  async insertEvent(calendarId: string, body: GoogleEvent): Promise<GoogleEvent> {
    return this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  /**
   * Met à jour un événement.
   *
   * L'en-tête `If-Match` porte l'etag connu : si l'événement a changé entre
   * temps chez Google, la requête est refusée (412) au lieu d'écraser la
   * modification de l'autre côté. C'est la garde contre les modifications
   * simultanées.
   */
  async patchEvent(
    calendarId: string,
    eventId: string,
    body: GoogleEvent,
    etag?: string | null,
  ): Promise<GoogleEvent> {
    return this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: etag ? { 'If-Match': etag } : {},
      },
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.request<void>(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' },
      );
    } catch (error) {
      // 404 / 410 : l'événement a déjà disparu chez Google. Le but est
      // atteint, ce n'est pas une erreur.
      const message = error instanceof Error ? error.message : '';
      if (!/\b(404|410)\b/.test(message)) throw error;
    }
  }
}
