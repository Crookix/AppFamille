import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test as base, expect, type Page } from '@playwright/test';

/**
 * Outillage commun aux parcours de bout en bout.
 *
 * Deux principes :
 *
 * 1. **On ne triche pas sur le chemin de l'utilisateur.** La connexion passe
 *    par le vrai lien magique et le vrai `/auth/callback` ; on utilise la clé
 *    `service_role` seulement pour fabriquer ce lien, ce que ferait autrement
 *    la boîte mail.
 * 2. **On nettoie derrière soi.** Chaque parcours crée ses propres comptes,
 *    préfixés `e2e-`, et les supprime à la fin. Un foyer supprimé emporte ses
 *    données en cascade.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Ce qui manque pour jouer les parcours, ou `null` si tout est là. */
export function missingConfig(): string | null {
  if (!url) return 'NEXT_PUBLIC_SUPABASE_URL est absente de .env.local';
  if (!serviceKey) {
    return (
      'SUPABASE_SERVICE_ROLE_KEY est absente de .env.local. ' +
      'Elle sert uniquement à créer les comptes de test et leurs liens de connexion.'
    );
  }
  return null;
}

export function adminClient(): SupabaseClient {
  return createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Adresse unique, reconnaissable, pour ne jamais heurter un vrai compte. */
export function e2eEmail(role: string): string {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return `e2e-${role}-${suffix}@tribu.test`;
}

export type TestUser = { id: string; email: string };

export async function createUser(admin: SupabaseClient, role: string): Promise<TestUser> {
  const email = e2eEmail(role);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: role },
  });
  if (error || !data.user) {
    throw new Error(`Création du compte de test impossible : ${error?.message}`);
  }
  return { id: data.user.id, email };
}

export async function deleteUser(admin: SupabaseClient, user: TestUser) {
  // Supprimer le compte suffit : les foyers dont il est l'unique membre
  // partent en cascade avec lui.
  await admin.auth.admin.deleteUser(user.id).catch(() => {});
}

/**
 * Connecte une page en empruntant le vrai chemin du lien magique.
 *
 * `generateLink` renvoie le condensat que Supabase aurait envoyé par e-mail ;
 * on le donne à `/auth/callback` exactement comme le ferait un clic dans la
 * boîte mail.
 */
export async function signIn(page: Page, admin: SupabaseClient, user: TestUser) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  if (error || !data.properties?.hashed_token) {
    throw new Error(`Lien de connexion impossible à fabriquer : ${error?.message}`);
  }

  await page.goto(
    `/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink&suite=/`,
  );
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/'));
}

/** Déconnecte la page en vidant ses cookies. */
export async function signOut(page: Page) {
  await page.context().clearCookies();
}

/**
 * Crée un foyer depuis l'écran de bienvenue, comme le ferait l'utilisateur.
 * Renvoie le nom donné, pour pouvoir le retrouver à l'écran.
 */
export async function createHousehold(page: Page, name: string, firstName: string) {
  await page.goto('/bienvenue');
  await page.getByLabel(/Nom du foyer/i).fill(name);
  await page.getByLabel(/Votre prénom/i).fill(firstName);
  await page.getByRole('button', { name: /Créer (le|mon) foyer|Continuer|Terminer/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/bienvenue'), { timeout: 20_000 });
  return name;
}

/**
 * Variante de `test` qui saute proprement le fichier quand la configuration
 * manque, en disant ce qui manque plutôt qu'en échouant sur un `undefined`.
 */
export const test = base.extend<{ admin: SupabaseClient }>({
  admin: async ({}, use) => {
    await use(adminClient());
  },
});

export { expect };

export function skipIfUnconfigured() {
  const missing = missingConfig();
  base.skip(Boolean(missing), missing ?? '');
}
