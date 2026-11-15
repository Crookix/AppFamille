'use client';

import { useEffect } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';

/**
 * Écran d'erreur inattendue.
 *
 * Le message technique n'est pas montré : il n'aide pas la famille et peut
 * révéler des détails d'implémentation. Il reste dans la console pour le
 * diagnostic.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-5 text-center"
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-alert-100 text-[var(--alert-text)]">
        <TriangleAlert className="h-8 w-8" aria-hidden />
      </div>
      <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-[-0.025em]">Quelque chose a coincé</h1>
      <p className="mt-2 text-sm text-muted">
        L'affichage n'a pas abouti. Rien n'est perdu : réessayez, ou revenez à
        l'accueil.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-5 flex h-11 items-center gap-2 rounded-full bg-brand-500 px-5 font-semibold text-white transition-colors hover:bg-brand-600"
      >
        <RotateCw className="h-4 w-4" aria-hidden />
        Réessayer
      </button>

      <a
        href="/"
        className="mt-3 text-sm font-semibold text-[var(--accent-text)] underline underline-offset-2"
      >
        Retour à l'accueil
      </a>

      {error.digest ? (
        <p className="mt-6 font-mono text-[0.75rem] text-muted">
          Référence : {error.digest}
        </p>
      ) : null}
    </main>
  );
}
