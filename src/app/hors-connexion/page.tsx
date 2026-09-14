import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';

export const metadata: Metadata = { title: 'Hors connexion' };

export default function HorsConnexionPage() {
  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-5 text-center"
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--fg-muted)]">
        <WifiOff className="h-8 w-8" aria-hidden />
      </div>
      <h1 className="text-xl font-extrabold tracking-tight">Pas de connexion</h1>
      <p className="mt-2 text-sm text-muted">
        MyFamily a besoin d'internet pour afficher les informations à jour du foyer —
        une course cochée par quelqu'un d'autre, un rendez-vous déplacé.
      </p>
      <p className="mt-4 text-sm text-muted">
        La page se rechargera d'elle-même dès que la connexion reviendra.
      </p>
    </main>
  );
}
