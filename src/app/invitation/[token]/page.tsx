import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, CircleSlash, Home, ShieldX } from 'lucide-react';
import { ensureProfile, getUser, isSupabaseConfigured } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AcceptInvitation } from '@/components/onboarding/accept-invitation';

export const metadata: Metadata = { title: 'Invitation' };

type PreviewState = 'valide' | 'invalide' | 'expiree' | 'revoquee' | 'deja_acceptee';

const REFUSALS: Record<
  Exclude<PreviewState, 'valide'>,
  { icon: React.ReactNode; title: string; body: string }
> = {
  invalide: {
    icon: <ShieldX className="h-7 w-7" aria-hidden />,
    title: 'Lien invalide',
    body: "Ce lien d'invitation n'existe pas. Vérifiez qu'il a été copié en entier, ou demandez-en un nouveau.",
  },
  expiree: {
    icon: <CalendarClock className="h-7 w-7" aria-hidden />,
    title: 'Invitation expirée',
    body: "Ce lien a dépassé sa durée de validité de 7 jours. Demandez une nouvelle invitation au foyer.",
  },
  revoquee: {
    icon: <CircleSlash className="h-7 w-7" aria-hidden />,
    title: 'Invitation annulée',
    body: 'Cette invitation a été annulée par le foyer. Demandez-en une nouvelle si besoin.',
  },
  deja_acceptee: {
    icon: <CircleSlash className="h-7 w-7" aria-hidden />,
    title: 'Invitation déjà utilisée',
    body: "Ce lien a déjà servi. Un lien d'invitation ne fonctionne qu'une fois.",
  },
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseConfigured()) {
    return (
      <Shell>
        <p className="text-sm text-muted">
          Cette installation de MyFamily n'est pas encore configurée.
        </p>
      </Shell>
    );
  }

  const user = await getUser();
  // L'invité peut arriver ici sans être jamais passé par « Bienvenue » :
  // son profil doit exister avant qu'accept_invitation n'aille y chercher
  // son prénom.
  if (user) await ensureProfile(user);

  // L'aperçu n'est lisible que connecté : il faut un compte pour rejoindre
  // un foyer, et cela évite d'exposer le nom d'un foyer à un lien deviné.
  if (!user) {
    return (
      <Shell>
        <h1 className="text-xl font-extrabold tracking-tight">Vous êtes invité·e</h1>
        <p className="mt-2 text-sm text-muted">
          Connectez-vous ou créez votre compte pour rejoindre ce foyer. Vous reviendrez
          ici automatiquement.
        </p>
        <Link
          href={`/connexion?suite=${encodeURIComponent(`/invitation/${token}`)}`}
          className="mt-5 flex h-11 w-full items-center justify-center rounded-full bg-brand-500 px-5 font-semibold text-white transition-colors hover:bg-brand-600"
        >
          Se connecter pour continuer
        </Link>
      </Shell>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('invitation_preview', { p_token: token });

  const preview = Array.isArray(data) ? data[0] : null;
  const state: PreviewState = error || !preview ? 'invalide' : (preview.state as PreviewState);

  if (state !== 'valide') {
    const refusal = REFUSALS[state];
    return (
      <Shell>
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-alert-100 text-alert-700">
          {refusal.icon}
        </div>
        <h1 className="text-lg font-extrabold tracking-tight">{refusal.title}</h1>
        <p className="mt-2 text-sm text-muted">{refusal.body}</p>
        <Link
          href="/"
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--line)] px-5 font-semibold transition-colors hover:bg-[var(--bg-subtle)]"
        >
          <Home className="h-4 w-4" aria-hidden />
          Retour à MyFamily
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <AcceptInvitation
        token={token}
        householdName={preview?.household_name ?? 'ce foyer'}
        inviterName={preview?.inviter_name ?? 'Un membre du foyer'}
        expiresAt={preview?.expires_at ?? null}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10"
    >
      <div className="surface rounded-[var(--radius-xl2)] p-6 text-center">{children}</div>
    </main>
  );
}
