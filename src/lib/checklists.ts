/**
 * Logique des check-lists : avancement, ordre, et lecture d'une liste collée.
 *
 * Tout est pur : aucune dépendance à Supabase, à React ou à la requête en
 * cours. C'est ce qui rend ce fichier testable directement.
 */

import type { ChecklistItemRow } from '@/lib/database.types';

/* -------------------------------------------------------------------------- */
/* Avancement                                                                 */
/* -------------------------------------------------------------------------- */

export type ChecklistProgress = {
  total: number;
  coches: number;
  restants: number;
  /** Entre 0 et 1. Vaut 0 sur une liste vide, jamais NaN. */
  ratio: number;
  /** Vrai seulement si la liste a au moins un point, tous cochés. */
  complete: boolean;
  /** Vrai si rien n'est coché — l'état d'une liste fraîchement remise à zéro. */
  vierge: boolean;
};

/**
 * Avancement d'une check-list.
 *
 * Le cas de la liste vide est traité explicitement : `0/0` n'est pas
 * « terminé ». Une valise sans contenu n'est pas une valise prête, et
 * l'afficher comme telle inviterait à partir sans rien.
 */
export function checklistProgress(
  items: readonly Pick<ChecklistItemRow, 'is_checked'>[],
): ChecklistProgress {
  const total = items.length;
  const coches = items.filter((i) => i.is_checked).length;

  return {
    total,
    coches,
    restants: total - coches,
    ratio: total === 0 ? 0 : coches / total,
    complete: total > 0 && coches === total,
    vierge: coches === 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Ordre                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ordre d'affichage : la position choisie, puis l'ancienneté.
 *
 * Une check-list se lit dans l'ordre où l'on range — chaussures avant manteau,
 * doudou en dernier pour qu'il ne soit pas au fond. Trier par « coché » ferait
 * bouger les lignes sous le doigt pendant qu'on coche : c'est exactement ce
 * qu'il ne faut pas ici, à l'inverse d'une liste de courses.
 */
export function sortChecklistItems<
  T extends Pick<ChecklistItemRow, 'position' | 'created_at'>,
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
  );
}

/** Position à donner au prochain point ajouté : à la fin. */
export function nextPosition(
  items: readonly Pick<ChecklistItemRow, 'position'>[],
): number {
  if (items.length === 0) return 0;
  return Math.max(...items.map((i) => i.position)) + 1;
}

/* -------------------------------------------------------------------------- */
/* Lecture d'une liste collée                                                 */
/* -------------------------------------------------------------------------- */

/** Puces, tirets et cases à cocher que les gens collent depuis ailleurs. */
const PUCES = /^[\s]*(?:[-–—*•·]|\[\s*[xX]?\s*\]|\d{1,3}[.)])\s+/;

/**
 * Transforme un texte collé en points de check-list.
 *
 * On ne saisit pas une valise ligne à ligne : on la colle depuis des notes,
 * un message, une liste trouvée ailleurs. Ces textes arrivent avec des tirets,
 * des puces, des numéros, parfois des cases `[ ]` — les garder ferait des
 * libellés « - Doudou » qui se liraient mal une fois affichés avec leur propre
 * case à cocher.
 *
 * Les doublons sont écartés en comparant sans la casse ni les espaces : coller
 * deux fois la même liste ne doit pas doubler la valise.
 */
export function parseChecklistDraft(texte: string | null | undefined): string[] {
  if (!texte) return [];

  const vus = new Set<string>();
  const points: string[] = [];

  for (const ligne of texte.split(/\r?\n/)) {
    const nettoyee = ligne.replace(PUCES, '').trim();
    if (!nettoyee) continue;

    const cle = nettoyee.toLocaleLowerCase('fr').replace(/\s+/g, ' ');
    if (vus.has(cle)) continue;

    vus.add(cle);
    // La colonne accepte 120 caractères : on coupe plutôt que de faire
    // échouer l'enregistrement de toute la liste sur une ligne trop longue.
    points.push(nettoyee.slice(0, 120));
  }

  return points;
}
