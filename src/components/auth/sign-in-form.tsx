'use client';

import * as React from 'react';
import { Mail, MailCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input } from '@/components/ui/primitives';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.57-5.17 3.57-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

export function SignInForm({
  redirectTo,
  googleEnabled,
  initialError,
}: {
  redirectTo: string;
  googleEnabled: boolean;
  initialError?: string | null;
}) {
  const supabase = createClient();
  const [email, setEmail] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [googleLoading, setGoogleLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(initialError ?? null);

  /** Empêche un lien d'invitation d'être détourné vers un site tiers. */
  function safeRedirect(target: string) {
    return target.startsWith('/') && !target.startsWith('//') ? target : '/';
  }

  async function sendMagicLink(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Indiquez votre adresse e-mail.');
      return;
    }

    setSending(true);
    setError(null);

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?suite=${encodeURIComponent(
          safeRedirect(redirectTo),
        )}`,
      },
    });

    setSending(false);

    if (sendError) {
      setError(
        sendError.message.includes('rate')
          ? 'Trop de demandes en peu de temps. Patientez une minute puis réessayez.'
          : "L'envoi a échoué. Vérifiez l'adresse et réessayez.",
      );
      return;
    }
    setSent(true);
  }

  async function signInWithGoogle() {
    setGoogleLoading(true);
    setError(null);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?suite=${encodeURIComponent(
          safeRedirect(redirectTo),
        )}`,
      },
    });

    if (oauthError) {
      setGoogleLoading(false);
      setError("La connexion Google n'a pas pu démarrer. Utilisez votre adresse e-mail.");
    }
  }

  if (sent) {
    return (
      <div className="surface rounded-[var(--radius-xl2)] p-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sage-100 text-sage-700">
          <MailCheck className="h-7 w-7" aria-hidden />
        </div>
        <h2 className="text-base font-bold">Regardez votre boîte mail</h2>
        <p className="mt-1.5 text-sm text-muted">
          Un lien de connexion vient d'être envoyé à <strong>{email.trim()}</strong>.
          Ouvrez-le sur cet appareil pour entrer dans MyFamily.
        </p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => {
            setSent(false);
            setError(null);
          }}
        >
          Utiliser une autre adresse
        </Button>
      </div>
    );
  }

  return (
    <div className="surface rounded-[var(--radius-xl2)] p-5">
      {googleEnabled ? (
        <>
          <Button
            variant="outline"
            className="w-full"
            onClick={signInWithGoogle}
            loading={googleLoading}
          >
            {googleLoading ? null : <GoogleMark />}
            Continuer avec Google
          </Button>

          <div className="my-4 flex items-center gap-3 text-xs font-semibold text-muted">
            <span className="h-px flex-1 bg-[var(--line)]" />
            ou
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
        </>
      ) : null}

      <form onSubmit={sendMagicLink} className="space-y-3">
        <Field label="Adresse e-mail">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="prenom@exemple.fr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Button type="submit" className="w-full" loading={sending}>
          {sending ? null : <Mail className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
          Recevoir un lien de connexion
        </Button>
      </form>

      {error ? <ErrorNote className="mt-3">{error}</ErrorNote> : null}

      <p className="mt-4 text-center text-xs text-muted">
        Pas besoin de mot de passe : un lien à usage unique vous est envoyé.
      </p>

      {!googleEnabled ? (
        <p className="mt-3 rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-2.5 text-xs text-muted">
          La connexion Google n'est pas encore configurée sur cette installation.
          Voir <code className="font-semibold">docs/GOOGLE.md</code>.
        </p>
      ) : null}
    </div>
  );
}
