import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActiveHousehold, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';

export const metadata: Metadata = { title: 'Bienvenue' };

export default async function BienvenuePage() {
  const user = await requireUser();

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

  return (
    <main id="contenu" className="min-h-dvh px-5 py-10">
      <OnboardingFlow suggestedName={suggested} />
    </main>
  );
}
