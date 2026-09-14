import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { RecommendationRow, RecommendationWantRow } from '@/lib/database.types';

/** Une fiche et les membres qui ont dit « moi aussi ». */
export type RecommendationWithWants = RecommendationRow & {
  /** Identifiants de membres, dans l'ordre où les envies sont arrivées. */
  wants: string[];
};

/**
 * Charge les recommandations du foyer et leurs envies.
 *
 * Deux requêtes plutôt qu'une jointure imbriquée : PostgREST sait faire
 * `recommendations(*, recommendation_wants(member_id))`, mais le type qui en
 * sort ne se laisse pas décrire sans `as any`, et la consigne du dépôt est de
 * préférer deux requêtes simples. Elles partent ensemble, donc cela ne coûte
 * qu'un aller-retour.
 *
 * Le rapprochement se fait ici, en mémoire : un foyer a des dizaines de
 * fiches, pas des milliers.
 */
export async function loadRecommendations(
  householdId: string,
): Promise<RecommendationWithWants[]> {
  const supabase = await createClient();

  const [recosResult, wantsResult] = await Promise.all([
    supabase
      .from('recommendations')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('recommendation_wants')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true }),
  ]);

  const recos: RecommendationRow[] = recosResult.data ?? [];
  const wants: RecommendationWantRow[] = wantsResult.data ?? [];

  const byReco = new Map<string, string[]>();
  for (const want of wants) {
    const current = byReco.get(want.recommendation_id);
    if (current) current.push(want.member_id);
    else byReco.set(want.recommendation_id, [want.member_id]);
  }

  return recos.map((reco) => ({ ...reco, wants: byReco.get(reco.id) ?? [] }));
}
