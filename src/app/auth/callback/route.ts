import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Retour d'authentification : lien magique et OAuth aboutissent tous deux ici.
 *
 * Le code reçu est échangé côté serveur contre une session, puis l'utilisateur
 * est renvoyé là où il voulait aller. La destination est vérifiée : seul un
 * chemin interne est accepté, pour qu'un lien fabriqué ne puisse pas rediriger
 * vers un site tiers juste après la connexion.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const requested = searchParams.get('suite') ?? '/';

  const suite =
    requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  // Erreur renvoyée par le fournisseur (refus de consentement, lien périmé).
  if (searchParams.get('error')) {
    return NextResponse.redirect(new URL('/connexion?erreur=oauth', origin));
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL('/connexion?erreur=lien', origin));
    }
    return NextResponse.redirect(new URL(suite, origin));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'magiclink' | 'email' | 'signup' | 'recovery' | 'invite',
    });
    if (error) {
      return NextResponse.redirect(new URL('/connexion?erreur=lien', origin));
    }
    return NextResponse.redirect(new URL(suite, origin));
  }

  return NextResponse.redirect(new URL('/connexion?erreur=lien', origin));
}
