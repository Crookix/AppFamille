'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/components/providers/use-supabase';

/**
 * Rafraîchit l'écran quand une table du foyer change chez quelqu'un d'autre.
 *
 * Deux parents qui organisent la semaine ensemble, chacun sur son téléphone,
 * doivent voir les modifications de l'autre sans avoir à recharger. Supabase
 * pousse les changements par Realtime ; on se contente d'appeler
 * `router.refresh()`, ce qui laisse le serveur recalculer la page — plus sûr
 * que d'essayer de rejouer la modification côté client, où l'on n'a ni les
 * jointures ni les règles d'affichage.
 *
 * Le filtre `household_id` est indispensable : sans lui, chaque foyer
 * recevrait les changements de tous les autres. La RLS empêcherait la fuite
 * du contenu, mais pas le rafraîchissement inutile.
 */
export function useHouseholdRealtime(householdId: string, tables: string[]) {
  const router = useRouter();
  const supabase = useSupabase();

  // Les appelants passent un tableau littéral, recréé à chaque rendu ; on le
  // fige en chaîne pour ne pas réabonner le canal à chaque fois.
  const key = tables.join(',');

  React.useEffect(() => {
    const channel = supabase.channel(`foyer-${householdId}-${key}`);

    for (const table of key.split(',')) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `household_id=eq.${householdId}`,
        },
        () => router.refresh(),
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, householdId, key, router]);
}
