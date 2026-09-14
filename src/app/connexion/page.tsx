import type { Metadata } from 'next';
import { isSupabaseConfigured } from '@/lib/auth';
import { clerkHostedSignInUrl, isClerkConfigured } from '@/lib/clerk';
import { SignInForm } from '@/components/auth/sign-in-form';
import { ClerkSignIn } from '@/components/auth/clerk-sign-in';
import { SetupNotice } from '@/components/auth/setup-notice';

export const metadata: Metadata = { title: 'Connexion' };

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string; erreur?: string }>;
}) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID);
  // Clerk, quand il est branché, remplace le formulaire de lien magique.
  // Les deux ne s'affichent jamais ensemble : deux façons de se connecter
  // côte à côte, c'est une hésitation, pas un choix.
  const viaClerk = isClerkConfigured();

  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10"
    >
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-brand-500 text-3xl shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" className="h-16 w-16" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">MyFamily</h1>
        <p className="mt-1.5 text-sm text-muted">
          Le calendrier, les tâches, les courses et les gardes de la famille,
          au même endroit.
        </p>
      </div>

      {!configured ? (
        <SetupNotice />
      ) : viaClerk ? (
        <ClerkSignIn
          redirectTo={params.suite ?? '/'}
          portalUrl={clerkHostedSignInUrl(params.suite ?? '/')}
        />
      ) : (
        <SignInForm
          redirectTo={params.suite ?? '/'}
          googleEnabled={googleEnabled}
          initialError={
            params.erreur === 'oauth'
              ? "La connexion Google n'a pas abouti. Réessayez ou utilisez votre adresse e-mail."
              : params.erreur === 'lien'
                ? 'Ce lien de connexion a expiré ou a déjà servi. Demandez-en un nouveau.'
                : null
          }
        />
      )}
    </main>
  );
}
