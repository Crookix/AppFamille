import type { Metadata } from 'next';
import { requireHousehold } from '@/lib/auth';
import { loadRecommendations } from '@/lib/data/recommendations';
import { RecoBoard } from '@/components/reco/reco-board';
import { RECO_KINDS } from '@/lib/recommendations';

export const metadata: Metadata = { title: 'Reco' };

/**
 * Les envies du foyer : sans paramètre, un bouton par genre ; avec
 * `?genre=film`, la seule liste des films.
 */
export default async function RecoPage({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string }>;
}) {
  const { genre } = await searchParams;
  const { household } = await requireHousehold();
  const recommendations = await loadRecommendations(household.id);

  const kind = RECO_KINDS.find((k) => k.key === genre)?.key ?? null;

  return <RecoBoard initial={recommendations} kind={kind} />;
}
