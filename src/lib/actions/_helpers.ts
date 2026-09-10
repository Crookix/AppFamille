import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getActiveHousehold, getUser } from '@/lib/auth';

/** Résultat uniforme des actions serveur, pour un affichage d'erreur homogène. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/**
 * Vérifie que l'utilisateur est bien membre du foyer visé.
 *
 * La RLS empêche déjà toute écriture hors de son foyer ; ce contrôle sert à
 * répondre par un message clair plutôt que par une erreur de base de données,
 * et à couvrir les actions qui empruntent le client à privilèges élevés.
 */
export async function requireMembership(householdId: string) {
  const user = await getUser();
  if (!user) return fail('Connexion requise.');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('*')
    .eq('household_id', householdId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return fail("Vous n'êtes pas membre de ce foyer.");
  return ok({ user, member: data, supabase });
}

/** Même chose, mais pour le foyer actif de l'utilisateur. */
export async function requireActiveHousehold() {
  const active = await getActiveHousehold();
  if (!active) return fail('Aucun foyer actif.');
  const supabase = await createClient();
  return ok({ ...active, supabase });
}

/**
 * Traduit une erreur PostgreSQL en message compréhensible.
 *
 * Les codes retenus sont ceux que les contraintes du schéma peuvent réellement
 * remonter à l'utilisateur.
 */
export function humanizeDbError(error: { code?: string; message?: string } | null): string {
  if (!error) return "L'enregistrement a échoué.";

  switch (error.code) {
    case '23505':
      return 'Cet élément existe déjà.';
    case '23503':
      return "L'élément lié n'existe plus. Rechargez la page.";
    case '23514':
      return 'Certaines valeurs ne sont pas acceptées. Vérifiez le formulaire.';
    case '42501':
      return "Vous n'avez pas les droits nécessaires pour cette action.";
    case 'PGRST116':
      return 'Élément introuvable.';
    default:
      return error.message || "L'enregistrement a échoué.";
  }
}
