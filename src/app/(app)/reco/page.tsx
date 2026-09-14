import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { loadRecommendations } from '@/lib/data/recommendations';
import { RecoBoard } from '@/components/reco/reco-board';

export const metadata: Metadata = { title: 'Reco' };

/**
 * Les envies du foyer : films, séries, théâtre, idées cadeaux.
 */
export default async function RecoPage() {
  const { household } = await requireHousehold();
  const recommendations = await loadRecommendations(household.id);

  return <RecoBoard initial={recommendations} />;
}
