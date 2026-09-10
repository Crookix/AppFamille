import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

/** Chemins accessibles sans être connecté. */
const PUBLIC_PATHS = ['/connexion', '/invitation', '/auth', '/api/auth', '/legal'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Rafraîchit la session à chaque navigation et protège les pages privées.
 *
 * Sans ce passage, le jeton d'accès expirerait au bout d'une heure et les
 * Server Components verraient un utilisateur déconnecté.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sans configuration Supabase, on laisse passer : la page d'accueil affiche
  // alors un écran d'installation explicite plutôt qu'une erreur opaque.
  if (!url || !key) return response;

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // `getUser()` et non `getSession()` : seule cette méthode revalide le jeton
  // auprès du serveur d'authentification.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/connexion';
    redirect.search = '';
    if (pathname !== '/') {
      redirect.searchParams.set('suite', `${pathname}${search}`);
    }
    return NextResponse.redirect(redirect);
  }

  if (user && pathname === '/connexion') {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}
