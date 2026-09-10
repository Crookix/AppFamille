import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import {
  buildAuthorizationUrl,
  createStateToken,
  hashState,
  isGoogleConfigured,
  STATE_COOKIE,
} from '@/lib/google/oauth';

/**
 * Démarre l'autorisation Google Agenda.
 *
 * Cette étape est distincte de la connexion à Tribu avec Google : on peut être
 * connecté depuis des mois sans avoir jamais donné accès à son agenda.
 */
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;

  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/connexion?suite=/plus/google', origin));
  }

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL('/plus/google?erreur=non_configure', origin));
  }

  const state = createStateToken();
  const cookieStore = await cookies();

  // Seul le condensat est stocké : le cookie ne révèle pas le jeton attendu.
  cookieStore.set(STATE_COOKIE, hashState(state), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });

  return NextResponse.redirect(buildAuthorizationUrl(state));
}
