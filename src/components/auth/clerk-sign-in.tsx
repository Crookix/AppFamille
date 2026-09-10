'use client';

import * as React from 'react';
import { ClerkLoaded, ClerkLoading, SignIn } from '@clerk/nextjs';
import { LoaderCircle, WifiOff } from 'lucide-react';

/**
 * Écran de connexion Clerk, avec un filet de secours.
 *
 * Le formulaire de Clerk est monté par un script chargé depuis le domaine de
 * l'instance. Ce script peut ne jamais arriver : réseau mobile capricieux,
 * bloqueur de contenu, et surtout Safari sur iPhone, qui se méfie des
 * ressources d'un domaine tiers — ce qu'est justement une instance de
 * développement Clerk.
 *
 * Sans précaution, l'écran reste alors figé sur le logo et le slogan, sans
 * bouton, sans message, indéfiniment. C'est arrivé, et c'est inacceptable :
 * tout le reste de l'application dit ce qui ne va pas quand quelque chose
 * manque. Cet écran doit en faire autant.
 *
 * On affiche donc un état de chargement, puis — s'il s'éternise — une
 * explication et deux issues.
 */
export function ClerkSignIn({ redirectTo, portalUrl }: {
  redirectTo: string;
  portalUrl: string | null;
}) {
  return (
    <>
      <ClerkLoading>
        <Patience portalUrl={portalUrl} />
      </ClerkLoading>

      <ClerkLoaded>
        <SignIn
          routing="hash"
          forceRedirectUrl={redirectTo}
          signUpForceRedirectUrl={redirectTo}
        />
      </ClerkLoaded>
    </>
  );
}

/** Huit secondes : au-delà, ce n'est plus de la lenteur, c'est une panne. */
const DELAI_AVANT_AVEU = 8_000;

function Patience({ portalUrl }: { portalUrl: string | null }) {
  const [tropLong, setTropLong] = React.useState(false);

  React.useEffect(() => {
    const minuteur = setTimeout(() => setTropLong(true), DELAI_AVANT_AVEU);
    return () => clearTimeout(minuteur);
  }, []);

  if (!tropLong) {
    return (
      <div className="surface flex items-center justify-center gap-2.5 rounded-[var(--radius-xl2)] p-8 text-sm text-muted">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
        Chargement de la connexion…
      </div>
    );
  }

  return (
    <div className="surface rounded-[var(--radius-xl2)] p-5">
      <div className="mb-3 flex items-center gap-2 text-honey-700">
        <WifiOff className="h-5 w-5" aria-hidden />
        <h2 className="text-base font-bold">Le formulaire ne s'affiche pas</h2>
      </div>

      <p className="text-sm text-muted">
        Le module de connexion n'a pas pu être chargé. C'est souvent un
        navigateur qui bloque les contenus d'autres sites — fréquent sur iPhone.
      </p>

      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 flex h-11 w-full items-center justify-center rounded-full bg-brand-500 px-5 font-semibold text-white transition-colors hover:bg-brand-600"
      >
        Réessayer
      </button>

      {portalUrl ? (
        <a
          href={portalUrl}
          className="mt-2.5 flex h-11 w-full items-center justify-center rounded-full border border-[var(--line)] px-5 font-semibold transition-colors hover:bg-[var(--bg-subtle)]"
        >
          Se connecter sur une page dédiée
        </a>
      ) : null}

      <p className="mt-4 text-xs text-muted">
        Si le problème persiste : dans Réglages › Safari, désactivez « Empêcher
        le suivi entre sites », ou essayez avec Chrome.
      </p>
    </div>
  );
}
