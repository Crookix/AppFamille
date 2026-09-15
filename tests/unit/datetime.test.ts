import { describe, expect, it } from 'vitest';
import { shiftEndWithStart } from '@/lib/datetime';

/**
 * Ce fichier existe pour un bogue précis, trouvé le 15 septembre 2026 en
 * cherchant pourquoi le parcours calendrier échouait.
 *
 * Avancer le début d'un événement décale sa fin d'autant. Le calcul lisait les
 * deux champs avec `new Date(valeur)` — donc dans le fuseau du NAVIGATEUR —
 * puis réécrivait la fin avec `.toISOString()` — donc en UTC — dans un champ
 * qui attend l'heure du FOYER.
 *
 * L'erreur valait exactement le décalage du fuseau : zéro sur une machine
 * réglée en UTC, deux heures à Paris en été. Elle était donc invisible en
 * intégration continue et bien réelle sur le téléphone de la famille, qui
 * voyait la fin passer AVANT le début et l'enregistrement être refusé.
 */
describe('décalage de la fin quand le début bouge', () => {
  it('conserve la durée dans le fuseau du foyer', () => {
    // 9 h – 10 h, avancé à 18 h : la fin doit suivre à 19 h.
    expect(
      shiftEndWithStart('2026-07-01T09:00', '2026-07-01T10:00', '2026-07-01T18:00', 'Europe/Paris'),
    ).toBe('2026-07-01T19:00');
  });

  it('ne remet jamais la fin avant le début — le bogue exact', () => {
    const fin = shiftEndWithStart(
      '2026-07-01T09:00',
      '2026-07-01T10:00',
      '2026-07-01T18:00',
      'Europe/Paris',
    );
    expect(fin).not.toBeNull();
    expect(fin! > '2026-07-01T18:00').toBe(true);
    // La valeur fautive produite par l'ancien calcul, notée pour qu'elle ne
    // revienne pas : 18 h + 1 h, réécrit en UTC, donnait 17 h.
    expect(fin).not.toBe('2026-07-01T17:00');
  });

  it('donne le même résultat quel que soit le fuseau, à durée égale', () => {
    for (const tz of ['Europe/Paris', 'UTC', 'America/New_York', 'Pacific/Auckland']) {
      expect(
        shiftEndWithStart('2026-07-01T09:00', '2026-07-01T10:30', '2026-07-01T14:00', tz),
      ).toBe('2026-07-01T15:30');
    }
  });

  it('traverse un changement d’heure sans perdre la durée murale', () => {
    // En 2026, l'heure d'été finit en France le dimanche 25 octobre.
    // Une heure de réunion déplacée au lendemain du changement reste une heure.
    expect(
      shiftEndWithStart('2026-10-24T09:00', '2026-10-24T10:00', '2026-10-26T09:00', 'Europe/Paris'),
    ).toBe('2026-10-26T10:00');
  });

  it('ne décale rien quand il n’y a rien à décaler', () => {
    expect(shiftEndWithStart('', '2026-07-01T10:00', '2026-07-01T18:00')).toBeNull();
    expect(shiftEndWithStart('2026-07-01T09:00', '', '2026-07-01T18:00')).toBeNull();
    expect(shiftEndWithStart('2026-07-01T09:00', '2026-07-01T10:00', '')).toBeNull();
    expect(shiftEndWithStart('n’importe quoi', '2026-07-01T10:00', '2026-07-01T18:00')).toBeNull();
    // Fin déjà antérieure au début : on ne propage pas une incohérence.
    expect(
      shiftEndWithStart('2026-07-01T10:00', '2026-07-01T09:00', '2026-07-01T18:00'),
    ).toBeNull();
  });
});
