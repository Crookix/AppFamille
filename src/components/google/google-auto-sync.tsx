'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { OPEN_SCREEN_STALE_MINUTES } from '@/lib/google/schedule';

/**
 * Synchronise l'agenda Google à l'ouverture de l'écran, sans rien afficher.
 *
 * C'est le déclencheur qui couvre l'usage réel : le moment où l'on veut voir
 * son calendrier à jour est celui où on l'ouvre. Le cron et les notifications
 * de Google s'occupent du reste du temps ; celui-ci s'occupe du moment qui
 * compte.
 *
 * Trois choix expliquent la forme de ce composant :
 *
 * 1. **C'est le serveur qui décide.** Le navigateur ne fait que demander
 *    « synchronise si ça date de plus de N minutes ». Deux onglets ouverts ne
 *    peuvent donc pas se contredire, et la règle reste au même endroit que
 *    celles du cron.
 *
 * 2. **Rien ne s'affiche.** Ni « en cours », ni « réussi ». Une
 *    synchronisation d'arrière-plan qui annoncerait sa réussite violerait la
 *    règle la plus stricte de l'intégration ; et un bandeau à chaque ouverture
 *    du calendrier serait du bruit. Les échecs, eux, sont bien visibles — sur
 *    l'écran Google Agenda, avec leur cause.
 *
 * 3. **On ne rafraîchit que si quelque chose a bougé.** Un `router.refresh()`
 *    systématique relancerait le rendu serveur de la page à chaque ouverture,
 *    pour réafficher exactement la même chose.
 */

/** Trace de la dernière tentative, pour ne pas repartir à chaque navigation. */
const STORAGE_KEY = 'myfamily:derniere-sync-agenda';

/**
 * Garde de portée module.
 *
 * `sessionStorage` ne suffit pas : deux montages rapprochés — le double rendu
 * du mode strict en développement, ou un changement de vue — partiraient
 * ensemble avant que le premier n'ait rien écrit.
 */
let inFlight = false;

function attemptedRecently(): boolean {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < OPEN_SCREEN_STALE_MINUTES * 60_000;
  } catch {
    // Navigation privée, stockage refusé : on tentera une fois de plus que
    // nécessaire, ce qui est sans conséquence.
    return false;
  }
}

function rememberAttempt(): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* sans mémoire, on se contente de la garde de module */
  }
}

export function GoogleAutoSync({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  React.useEffect(() => {
    if (!enabled || inFlight || attemptedRecently()) return;

    // Quitter l'écran n'annule pas la requête : une campagne coupée en deux
    // laisserait un calendrier à moitié synchronisé et sa ligne de journal
    // ouverte. On se contente d'ignorer le résultat.
    let abandoned = false;
    inFlight = true;
    rememberAttempt();

    (async () => {
      try {
        const response = await fetch('/api/google/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ifStaleMinutes: OPEN_SCREEN_STALE_MINUTES }),
        });

        if (!response.ok) return;

        const payload = (await response.json()) as {
          totals?: { imported: number; updated: number; exported: number; deleted: number };
        };

        const totals = payload.totals;
        if (!totals || abandoned) return;

        if (totals.imported || totals.updated || totals.exported || totals.deleted) {
          router.refresh();
        }
      } catch {
        // Hors ligne, requête annulée, Google indisponible : l'écran reste tel
        // qu'il est, et l'erreur éventuelle est consignée côté serveur.
      } finally {
        inFlight = false;
      }
    })();

    return () => {
      abandoned = true;
    };
  }, [enabled, router]);

  return null;
}
