import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ensureProfile, getActiveHousehold, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { forgetPendingInvitation, readPendingInvitation } from '@/lib/invitations.server';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';
import { PendingInvitation } from '@/components/onboarding/pending-invitation';

export const metadata: Metadata = { title: 'Bienvenue' };

export default async function BienvenuePage() {
  const user = await requireUser();

  // Avec Clerk, aucun déclencheur ne crée le profil : c'est ici, au premier
  // écran qui suit la connexion, qu'il prend naissance. L'appel est
  // idempotent et ne réécrit jamais un prénom déjà choisi.
  await ensureProfile(user);

  // Déjà membre d'un foyer : ce parcours n'a plus lieu d'être.
  const active = await getActiveHousehold();
  if (active) redirect('/');

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .maybeSingle();

  const suggested =
    profile?.full_name?.trim() ||
    profile?.email?.split('@')[0] ||
    user.email?.split('@')[0] ||
    '';

  // Une invitation retenue au passage sur `/invitation/…` ? On la repropose
  // ici, sinon la personne créerait un second foyer en croyant rejoindre le
  // premier — c'est arrivé.
  const pendingToken = await readPendingInvitation();
  let pending: { token: string; householdName: string; inviterName: string } | null = null;

  if (pendingToken) {
    const { data: apercu } = await supabase.rpc('invitation_preview', {
      p_token: pendingToken,
    });
    const first = Array.isArray(apercu) ? apercu[0] : null;

    if (first?.state === 'valide' && first.household_name) {
      pending = {
        token: pendingToken,
        householdName: first.household_name,
        inviterName: first.inviter_name ?? 'Un membre du foyer',
      };
    } else {
      // Jeton mort : inutile de proposer indéfiniment une porte fermée.
      await forgetPendingInvitation();
    }
  }

  return (
    <main id="contenu" className="min-h-dvh px-5 py-10">
      {pending ? (
        <div className="mx-auto w-full max-w-md">
          <PendingInvitation {...pending} />
        </div>
      ) : null}
      <OnboardingFlow
        suggestedName={suggested}
        demoEnabled={process.env.NEXT_PUBLIC_ENABLE_DEMO === '1'}
      />
    </main>
  );
}
