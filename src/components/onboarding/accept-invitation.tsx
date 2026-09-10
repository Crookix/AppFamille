'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/primitives';
import { acceptInvitationAction } from '@/lib/actions/household';
import { formatDayLong } from '@/lib/datetime';

export function AcceptInvitation({
  token,
  householdName,
  inviterName,
  expiresAt,
}: {
  token: string;
  householdName: string;
  inviterName: string;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);

    const result = await acceptInvitationAction(token);

    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }

    // On garde l'état « en cours » jusqu'à la navigation : l'écran ne doit pas
    // redevenir cliquable entre l'acceptation et la redirection.
    router.push('/');
    router.refresh();
  }

  return (
    <>
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700">
        <Users className="h-7 w-7" aria-hidden />
      </div>

      <h1 className="text-xl font-extrabold tracking-tight">
        Rejoindre {householdName}
      </h1>
      <p className="mt-2 text-sm text-muted">
        <strong>{inviterName}</strong> vous invite à partager l'organisation du foyer :
        calendrier, tâches, courses, repas et gardes.
      </p>

      <Button className="mt-5 w-full" onClick={accept} loading={pending}>
        Rejoindre le foyer
      </Button>

      {error ? <ErrorNote className="mt-4 text-left">{error}</ErrorNote> : null}

      {expiresAt ? (
        <p className="mt-4 text-xs text-muted">
          Invitation valable jusqu'au {formatDayLong(expiresAt.slice(0, 10), { withYear: true })}.
        </p>
      ) : null}
    </>
  );
}
