import { describe, expect, it } from 'vitest';
import {
  checklistProgress,
  nextPosition,
  parseChecklistDraft,
  sortChecklistItems,
} from '@/lib/checklists';

function point(overrides: Partial<{ is_checked: boolean; position: number; created_at: string }> = {}) {
  return {
    is_checked: false,
    position: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('avancement', () => {
  it('compte ce qui est coché et ce qui reste', () => {
    const p = checklistProgress([point({ is_checked: true }), point(), point()]);
    expect(p.total).toBe(3);
    expect(p.coches).toBe(1);
    expect(p.restants).toBe(2);
    expect(p.ratio).toBeCloseTo(1 / 3);
  });

  it('ne déclare « complète » qu’une liste non vide entièrement cochée', () => {
    expect(checklistProgress([point({ is_checked: true })]).complete).toBe(true);
    expect(checklistProgress([point({ is_checked: true }), point()]).complete).toBe(false);
  });

  it('ne dit pas d’une liste vide qu’elle est prête', () => {
    // Une valise sans contenu n'est pas une valise prête : l'afficher comme
    // telle inviterait à partir sans rien.
    const p = checklistProgress([]);
    expect(p.complete).toBe(false);
    expect(p.ratio).toBe(0);
    expect(Number.isNaN(p.ratio)).toBe(false);
  });

  it('reconnaît une liste fraîchement remise à zéro', () => {
    expect(checklistProgress([point(), point()]).vierge).toBe(true);
    expect(checklistProgress([point({ is_checked: true }), point()]).vierge).toBe(false);
  });
});

describe('ordre', () => {
  it('suit la position, puis l’ancienneté', () => {
    const items = [
      { ...point({ position: 2 }), label: 'Manteau' },
      { ...point({ position: 0 }), label: 'Chaussures' },
      { ...point({ position: 1, created_at: '2026-02-01T00:00:00.000Z' }), label: 'Pyjama' },
      { ...point({ position: 1, created_at: '2026-01-05T00:00:00.000Z' }), label: 'Doudou' },
    ];
    expect(sortChecklistItems(items).map((i) => i.label)).toEqual([
      'Chaussures',
      'Doudou',
      'Pyjama',
      'Manteau',
    ]);
  });

  it('ne fait pas bouger les lignes selon qu’elles sont cochées', () => {
    // Trier par « coché » déplacerait les lignes sous le doigt pendant qu'on
    // coche. Une check-list se lit dans l'ordre où l'on range.
    const items = [
      { ...point({ position: 0, is_checked: true }), label: 'A' },
      { ...point({ position: 1 }), label: 'B' },
    ];
    expect(sortChecklistItems(items).map((i) => i.label)).toEqual(['A', 'B']);
  });

  it('ne modifie pas le tableau reçu', () => {
    const items = [point({ position: 2 }), point({ position: 1 })];
    const copie = [...items];
    sortChecklistItems(items);
    expect(items).toEqual(copie);
  });

  it('ajoute le point suivant à la fin', () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([point({ position: 0 }), point({ position: 4 })])).toBe(5);
  });
});

describe('liste collée', () => {
  it('retire les puces, tirets, numéros et cases', () => {
    const texte = `- Doudou
* Pyjama
• Brosse à dents
1. Chaussons
2) Maillot
[ ] Crème solaire
[x] Chapeau`;
    expect(parseChecklistDraft(texte)).toEqual([
      'Doudou',
      'Pyjama',
      'Brosse à dents',
      'Chaussons',
      'Maillot',
      'Crème solaire',
      'Chapeau',
    ]);
  });

  it('ignore les lignes vides et les espaces superflus', () => {
    expect(parseChecklistDraft('  Doudou  \n\n\n   \n  Pyjama\n')).toEqual([
      'Doudou',
      'Pyjama',
    ]);
  });

  it('écarte les doublons sans regarder la casse ni les espaces', () => {
    // Coller deux fois la même liste ne doit pas doubler la valise.
    expect(parseChecklistDraft('Doudou\ndoudou\n  DOUDOU  \nPyjama')).toEqual([
      'Doudou',
      'Pyjama',
    ]);
  });

  it('ne garde pas un tiret isolé pour un libellé', () => {
    expect(parseChecklistDraft('-\n- Doudou')).toEqual(['-', 'Doudou']);
  });

  it('coupe plutôt que de faire échouer toute la liste', () => {
    const long = 'a'.repeat(200);
    const [seul] = parseChecklistDraft(long);
    expect(seul).toHaveLength(120);
  });

  it('rend une liste vide sur un texte absent', () => {
    expect(parseChecklistDraft('')).toEqual([]);
    expect(parseChecklistDraft(null)).toEqual([]);
    expect(parseChecklistDraft('   \n  ')).toEqual([]);
  });
});
