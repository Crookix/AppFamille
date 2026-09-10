/**
 * Clerk, branché sans être imposé.
 *
 * Tribu sait s'authentifier de deux façons : par le lien magique de Supabase
 * Auth, ou par Clerk. Le choix ne se fait pas dans le code mais dans la
 * configuration : si les clés Clerk sont présentes, Clerk prend la main ;
 * sinon l'application continue exactement comme avant.
 *
 * Ce n'est pas de la prudence excessive. C'est ce qui permet de déployer sans
 * fenêtre de coupure, et de revenir en arrière en retirant une variable si
 * quelque chose se passe mal un dimanche soir.
 *
 * Côté base, les deux identités cohabitent depuis la migration 0013 :
 * l'identifiant utilisateur y est un texte opaque, lu dans le jeton via
 * `auth.jwt() ->> 'sub'`. Un UUID Supabase et un `user_2abc…` de Clerk sont
 * tous deux des textes valides.
 */

export function isClerkConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

/**
 * Variante lisible depuis le navigateur.
 *
 * `CLERK_SECRET_KEY` n'existe pas côté client — c'est voulu — donc on ne peut
 * y tester que la clé publiable. Les composants s'en servent pour savoir quelle
 * interface de connexion afficher ; la décision qui compte, elle, est prise
 * côté serveur.
 */
export function isClerkConfiguredInBrowser(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * Domaine de l'instance Clerk, déduit de la clé publiable.
 *
 * La clé publiable est un base64 du domaine suivi de « $ ». C'est ce domaine
 * que Supabase doit connaître pour accepter les jetons Clerk (Authentication ›
 * Third-Party Auth). L'exposer n'a rien de sensible : il est déjà dans le
 * paquet servi au navigateur.
 */
export function clerkInstanceDomain(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return null;

  const encoded = key.replace(/^pk_(test|live)_/, '');
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    return decoded.replace(/\$$/, '') || null;
  } catch {
    return null;
  }
}
