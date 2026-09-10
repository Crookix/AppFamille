'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/primitives';
import { acceptInvitationAction } from '@/lib/actions/household';

/**
 * Rappel d'invitation, en tête de l'écran de bienvenue.
 *
 * Volontairement placé AVANT la création de foyer, et visuellement dominant :
 * quelqu'un qui arrive ici avec une invitation en poche vient presque toujours
 * pour la rejoindre, pas pour fonder un second foyer. L'ordre des options est
 * la moitié du message.
 */
export function PendingInvitation({
  token,
  householdName,
  inviterName,
}: {
  token: string;
  householdName: string;
  inviterName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function rejoindre() {
    setPending(true);
    setError(null);

    const result = await acceptInvitationAction(token);
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }

    // On reste en état « en cours » jusqu'à la navigation : l'écran ne doit
    // pas redevenir cliquable entre l'acceptation et la redirection.
    router.push('/');
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-[var(--radius-xl2)] border border-brand-200 bg-brand-50 p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
          <Users className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold">Une invitation vous attend</h2>
          <p className="text-sm text-muted">
            <strong>{inviterName}</strong> vous invite à rejoindre{' '}
            <strong>{householdName}</strong>.
          </p>
        </div>
      </div>

      <Button className="w-full" onClick={rejoindre} loading={pending}>
        Rejoindre {householdName}
      </Button>

      {error ? <ErrorNote className="mt-3">{error}</ErrorNote> : null}

      <p className="mt-3 text-center text-xs text-muted">
        Ou créez votre propre foyer ci-dessous.
      </p>
    </section>
  );
}
