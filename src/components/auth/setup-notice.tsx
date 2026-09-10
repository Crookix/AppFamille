import { AlertCircle } from 'lucide-react';

/**
 * Écran affiché lorsque l'application n'est reliée à aucun projet Supabase.
 *
 * Mieux vaut une marche à suivre explicite qu'une page de connexion qui
 * échouerait sans expliquer pourquoi.
 */
export function SetupNotice() {
  return (
    <div className="surface rounded-[var(--radius-xl2)] p-5">
      <div className="mb-3 flex items-center gap-2 text-honey-700">
        <AlertCircle className="h-5 w-5" aria-hidden />
        <h2 className="text-base font-bold">Installation à terminer</h2>
      </div>

      <p className="text-sm text-muted">
        Tribu n'est relié à aucune base de données. Trois étapes suffisent :
      </p>

      <ol className="mt-3 space-y-2.5 text-sm">
        <li className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[0.7rem] font-bold text-brand-700">
            1
          </span>
          <span>
            Créez un projet sur{' '}
            <a
              href="https://supabase.com/dashboard"
              className="font-semibold text-brand-600 underline underline-offset-2"
              target="_blank"
              rel="noreferrer noopener"
            >
              supabase.com
            </a>
            .
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[0.7rem] font-bold text-brand-700">
            2
          </span>
          <span>
            Copiez <code className="font-semibold">.env.example</code> en{' '}
            <code className="font-semibold">.env.local</code> et renseignez les clés du projet.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[0.7rem] font-bold text-brand-700">
            3
          </span>
          <span>
            Lancez <code className="font-semibold">npm run db:push</code> pour créer les tables.
          </span>
        </li>
      </ol>

      <p className="mt-4 text-xs text-muted">
        La marche à suivre complète se trouve dans <code className="font-semibold">CLAUDE.md</code>.
      </p>
    </div>
  );
}
