import 'server-only';

import { cookies } from 'next/headers';
import { PENDING_INVITATION_COOKIE, looksLikeToken } from '@/lib/invitations';

/** L'invitation retenue au passage sur `/invitation/…`, si elle tient debout. */
export async function readPendingInvitation(): Promise<string | null> {
  const value = (await cookies()).get(PENDING_INVITATION_COOKIE)?.value;
  if (!value || !looksLikeToken(value)) return null;
  return value;
}

/**
 * Oublie l'invitation retenue.
 *
 * Appelée après une acceptation réussie, et aussi quand l'aperçu révèle un
 * jeton mort : garder un cookie qui ne mènera jamais nulle part reviendrait à
 * proposer indéfiniment de rejoindre un foyer qui ne veut plus de vous.
 */
export async function forgetPendingInvitation(): Promise<void> {
  (await cookies()).delete(PENDING_INVITATION_COOKIE);
}
