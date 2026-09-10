import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Autorisation Google Agenda.
 *
 * Volontairement distincte de la connexion au compte Google : on peut se
 * connecter à Tribu avec Google sans jamais donner accès à son agenda, et
 * inversement révoquer l'accès à l'agenda sans perdre son compte. C'est la
 * distinction que demande le cahier des charges, et elle est ici structurelle,
 * pas cosmétique.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/**
 * Portées demandées.
 *
 * `calendar.events` couvre la lecture ET l'écriture des événements ;
 * `calendar.calendarlist.readonly` sert uniquement à énumérer les calendriers
 * auxquels l'utilisateur est abonné. On ne demande rien de plus : pas d'accès
 * aux paramètres, aux partages ni à la création de calendriers.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'openid',
  'email',
  'profile',
];

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000';
  return `${base}/api/google/callback`;
}

/* -------------------------------------------------------------------------- */
/* Protection du retour d'autorisation                                        */
/* -------------------------------------------------------------------------- */

/**
 * Jeton d'état anti-CSRF.
 *
 * Sans lui, un tiers pourrait faire aboutir SON autorisation Google dans le
 * compte Tribu de la victime. Le jeton est déposé en cookie httpOnly et
 * comparé au retour, en temps constant.
 */
export function createStateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function statesMatch(received: string, storedHash: string): boolean {
  const a = Buffer.from(hashState(received));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* -------------------------------------------------------------------------- */
/* Flux OAuth                                                                 */
/* -------------------------------------------------------------------------- */

export function buildAuthorizationUrl(state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', googleRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '));
  // `offline` est indispensable pour obtenir un jeton de rafraîchissement,
  // sans quoi l'autorisation expirerait au bout d'une heure.
  url.searchParams.set('access_type', 'offline');
  // Google ne renvoie un jeton de rafraîchissement qu'à la PREMIÈRE
  // autorisation ; `consent` le redemande à chaque fois, ce qui rend la
  // reconnexion fiable après une révocation.
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Échange du code refusé par Google (${response.status}) : ${detail}`);
  }

  return response.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    // 400 `invalid_grant` : l'utilisateur a révoqué l'accès depuis son compte
    // Google, ou le jeton a expiré faute d'usage. Il faut réautoriser.
    throw new Error(
      response.status === 400
        ? "L'autorisation Google a été révoquée ou a expiré. Reconnectez votre agenda."
        : `Rafraîchissement refusé par Google (${response.status}) : ${detail}`,
    );
  }

  return response.json();
}

/** Révoque l'autorisation côté Google. */
export async function revokeToken(token: string): Promise<boolean> {
  const response = await fetch(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  return response.ok;
}

/** Extrait l'identité du compte à partir du jeton d'identité. */
export function decodeIdToken(idToken: string): { sub?: string; email?: string } {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return {};
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { sub?: string; email?: string };
    return { sub: parsed.sub, email: parsed.email };
  } catch {
    return {};
  }
}
