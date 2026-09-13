import { describe, expect, it } from 'vitest';
import { safeSlug } from '@/lib/exports';

/**
 * Le nom de fichier d'un export porte le prénom de la nounou. Il doit rester
 * lisible et sans surprise, y compris quand ce prénom porte une ligature —
 * `normalize('NFD')` ne les décompose pas, et « Lœtitia » devenait « l-titia ».
 */
describe('safeSlug', () => {
  it('développe les ligatures avant de retirer les accents', () => {
    expect(safeSlug('Lœtitia')).toBe('loetitia');
    expect(safeSlug('Cœur')).toBe('coeur');
  });

  it('retire les accents et met en minuscules', () => {
    expect(safeSlug('Amélie Noël')).toBe('amelie-noel');
  });

  it('réduit les séparations à un seul tiret, sans tiret aux extrémités', () => {
    expect(safeSlug("  L'été  2026 !  ")).toBe('l-ete-2026');
  });
});
