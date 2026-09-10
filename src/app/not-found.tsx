import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-5 text-center"
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-muted">
        <Compass className="h-8 w-8" aria-hidden />
      </div>
      <h1 className="text-xl font-extrabold tracking-tight">Page introuvable</h1>
      <p className="mt-2 text-sm text-muted">
        Cette page n'existe pas, ou l'élément a été supprimé entre-temps.
      </p>
      <Link
        href="/"
        className="mt-5 flex h-11 items-center rounded-full bg-brand-500 px-5 font-semibold text-white transition-colors hover:bg-brand-600"
      >
        Retour à l'accueil
      </Link>
    </main>
  );
}
