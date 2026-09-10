import { requireHousehold } from '@/lib/auth';
import { loadDashboard } from '@/lib/data/dashboard';
import { Dashboard } from '@/components/dashboard/dashboard';

/**
 * Accueil : « qu'est-ce qui est prévu, qui s'en occupe, qu'est-ce qu'il
 * reste à faire ». Tout le reste de l'application découle de cet écran.
 */
export default async function AccueilPage() {
  const { household } = await requireHousehold();
  const data = await loadDashboard(household.id, household.timezone);

  return <Dashboard data={data} />;
}
