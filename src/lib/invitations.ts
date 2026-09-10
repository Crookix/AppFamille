/**
 * Mémoire d'une invitation en cours — constantes partagées.
 *
 * Le problème qu'elle résout est arrivé pour de vrai : une personne reçoit un
 * lien d'invitation, l'ouvre, crée son compte — et se retrouve sur l'écran de
 * bienvenue, qui ne propose que « créer un foyer ». Rien ne lui dit qu'une
 * invitation l'attend. Elle crée alors un second foyer, vide, en croyant
 * rejoindre le premier.
 *
 * On retient donc le jeton au passage sur `/invitation/…`, pour pouvoir le
 * reproposer à l'arrivée.
 *
 * Ce fichier ne contient que des valeurs pures : il est lu par le middleware,
 * qui s'exécute en périphérie et n'a accès ni à `next/headers` ni à Node. Les
 * fonctions qui touchent réellement aux cookies vivent dans
 * `invitations.server.ts`.
 */

export const PENDING_INVITATION_COOKIE = 'tribu_invitation';

/** Sept jours : la durée de vie d'une invitation. */
const SEPT_JOURS = 60 * 60 * 24 * 7;

/**
 * Le cookie contient le jeton en clair — c'est la même valeur que dans l'URL,
 * donc aucune exposition nouvelle. `httpOnly` le met hors de portée du
 * JavaScript de la page, `sameSite: lax` l'empêche de partir vers un autre
 * site.
 */
export function invitationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SEPT_JOURS,
  };
}

/** Les jetons sont des base64url de 32 octets, soit 43 caractères. */
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,64}$/.test(value);
}

/** Extrait le jeton d'un chemin `/invitation/<jeton>`, s'il en porte un. */
export function tokenFromPath(pathname: string): string | null {
  const match = /^\/invitation\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  return looksLikeToken(token) ? token : null;
}
