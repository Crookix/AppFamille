import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { sortChecklistItems } from '@/lib/checklists';
import type { ChecklistItemRow, ChecklistRow } from '@/lib/database.types';

export type ChecklistWithItems = ChecklistRow & { items: ChecklistItemRow[] };

/**
 * Les check-lists du foyer et leur contenu.
 *
 * Deux requêtes plutôt qu'une jointure imbriquée — la consigne du dépôt quand
 * le type se dérobe — et elles partent ensemble : cela ne coûte qu'un
 * aller-retour.
 */
export async function loadChecklists(householdId: string): Promise<ChecklistWithItems[]> {
  const supabase = await createClient();

  const [listesResult, pointsResult] = await Promise.all([
    supabase
      .from('checklists')
      .select('*')
      .eq('household_id', householdId)
      .order('position', { ascending: true })
      .limit(100),
    supabase
      .from('checklist_items')
      .select('*')
      .eq('household_id', householdId)
      .limit(2000),
  ]);

  const listes: ChecklistRow[] = listesResult.data ?? [];
  const points: ChecklistItemRow[] = pointsResult.data ?? [];

  const parListe = new Map<string, ChecklistItemRow[]>();
  for (const point of points) {
    const actuels = parListe.get(point.checklist_id);
    if (actuels) actuels.push(point);
    else parListe.set(point.checklist_id, [point]);
  }

  return listes.map((liste) => ({
    ...liste,
    items: sortChecklistItems(parListe.get(liste.id) ?? []),
  }));
}
