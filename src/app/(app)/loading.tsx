import { Skeleton } from '@/components/ui/primitives';

/**
 * Squelette affiché pendant le chargement d'un écran.
 *
 * Il reprend la silhouette réelle de l'accueil plutôt qu'un rond qui tourne :
 * l'attente paraît plus courte et l'écran ne saute pas au moment du rendu.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Chargement">
      <div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-7 w-56" />
      </div>

      <div>
        <Skeleton className="mb-2 h-3 w-24" />
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-[var(--radius-xl2)]" />
          <Skeleton className="h-20 w-full rounded-[var(--radius-xl2)]" />
        </div>
      </div>

      <div>
        <Skeleton className="mb-2 h-3 w-20" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-xl2)]" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-24 w-full rounded-[var(--radius-xl2)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-xl2)]" />
      </div>
    </div>
  );
}
