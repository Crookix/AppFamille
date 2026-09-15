import { describe, expect, it } from 'vitest';
import {
  aggregateIngredients,
  combineQuantities,
  guessAisle,
  isKnownUnit,
  normalizeLabel,
  parseQuickEntry,
  parseUnit,
  unitsCompatible,
} from '@/lib/ingredients';

describe('normalisation des libellés', () => {
  it('ignore casse, accents et espaces superflus', () => {
    expect(normalizeLabel('  Tomates  ')).toBe(normalizeLabel('tomates'));
    expect(normalizeLabel('Œufs')).toBe(normalizeLabel('oeufs'));
    expect(normalizeLabel('Crème fraîche')).toBe(normalizeLabel('creme fraiche'));
  });

  it('rapproche singulier et pluriel', () => {
    expect(normalizeLabel('tomate')).toBe(normalizeLabel('tomates'));
    expect(normalizeLabel('Carottes')).toBe(normalizeLabel('carotte'));
  });

  it('retire les articles de tête', () => {
    expect(normalizeLabel('de la farine')).toBe(normalizeLabel('farine'));
    expect(normalizeLabel("d'huile d'olive")).toBe(normalizeLabel("huile d'olive"));
    expect(normalizeLabel('du sucre')).toBe(normalizeLabel('sucre'));
  });

  it('ne confond pas deux produits différents', () => {
    expect(normalizeLabel('lait')).not.toBe(normalizeLabel('lait de coco'));
    expect(normalizeLabel('poivron rouge')).not.toBe(normalizeLabel('poivron vert'));
  });
});

describe('compatibilité des unités', () => {
  it('rend les masses convertibles entre elles', () => {
    expect(unitsCompatible('g', 'kg')).toBe(true);
    expect(parseUnit('kg').toBase).toBe(1000);
  });

  it('rend les volumes convertibles entre eux', () => {
    expect(unitsCompatible('ml', 'L')).toBe(true);
    expect(unitsCompatible('cl', 'litre')).toBe(true);
  });

  it('ne convertit pas entre familles différentes', () => {
    expect(unitsCompatible('g', 'ml')).toBe(false);
    expect(unitsCompatible('kg', 'pièce')).toBe(false);
  });

  it('traite une unité absente comme un nombre de pièces', () => {
    expect(unitsCompatible(null, 'pièce')).toBe(true);
    expect(parseUnit(null).family).toBe('piece');
  });

  it("n'invente pas de conversion pour les unités de cuisine", () => {
    // Une cuillère à soupe de farine et une d'huile ne pèsent pas la même
    // chose : les convertir en grammes demanderait une densité par ingrédient.
    expect(unitsCompatible('c. à s.', 'g')).toBe(false);
    expect(unitsCompatible('c. à s.', 'c. à c.')).toBe(false);
    // En revanche, deux cuillères à soupe s'additionnent.
    expect(unitsCompatible('c. à s.', 'cuillere a soupe')).toBe(true);
  });
});

describe('regroupement des ingrédients', () => {
  it('additionne deux apports du même produit dans la même unité', () => {
    const result = aggregateIngredients([
      { label: 'Tomates', quantity: 400, unit: 'g' },
      { label: 'tomate', quantity: 200, unit: 'g' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].lines).toEqual([{ quantity: 600, unit: 'g', merged: true }]);
  });

  it('convertit avant d\'additionner quand les unités le permettent', () => {
    const result = aggregateIngredients([
      { label: 'Farine', quantity: 500, unit: 'g' },
      { label: 'farine', quantity: 1, unit: 'kg' },
    ]);

    expect(result).toHaveLength(1);
    // 1,5 kg s'affiche en kilos, pas en 1500 g.
    expect(result[0].lines).toEqual([{ quantity: 1.5, unit: 'kg', merged: true }]);
  });

  it('bascule les volumes en litres au-delà du seuil', () => {
    const result = aggregateIngredients([
      { label: 'Lait', quantity: 50, unit: 'cl' },
      { label: 'lait', quantity: 750, unit: 'ml' },
    ]);
    expect(result[0].lines).toEqual([{ quantity: 1.25, unit: 'L', merged: true }]);
  });

  it('garde des lignes distinctes quand les unités sont incompatibles', () => {
    const result = aggregateIngredients([
      { label: 'Tomates', quantity: 400, unit: 'g' },
      { label: 'Tomates', quantity: 2, unit: null },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].lines).toHaveLength(2);
    expect(result[0].lines).toContainEqual({ quantity: 400, unit: 'g', merged: false });
    expect(result[0].lines).toContainEqual({ quantity: 2, unit: null, merged: false });
  });

  it('ne fusionne pas deux produits différents', () => {
    const result = aggregateIngredients([
      { label: 'Lait', quantity: 500, unit: 'ml' },
      { label: 'Lait de coco', quantity: 400, unit: 'ml' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('met les quantités à l\'échelle du nombre de convives', () => {
    // Recette pour 4 portions, préparée pour 6 : coefficient 1,5.
    const result = aggregateIngredients([
      { label: 'Riz', quantity: 300, unit: 'g', scale: 1.5 },
    ]);
    expect(result[0].lines[0]).toEqual({ quantity: 450, unit: 'g', merged: false });
  });

  it('additionne correctement des apports à des échelles différentes', () => {
    const result = aggregateIngredients([
      { label: 'Riz', quantity: 200, unit: 'g', scale: 1.5 }, // 300
      { label: 'riz', quantity: 100, unit: 'g', scale: 2 }, // 200
    ]);
    expect(result[0].lines).toEqual([{ quantity: 500, unit: 'g', merged: true }]);
  });

  it("n'efface pas les quantités à cause d'un apport sans quantité", () => {
    // « du sel » ne doit pas faire disparaître les « 10 g de sel ».
    const result = aggregateIngredients([
      { label: 'Sel', quantity: 10, unit: 'g' },
      { label: 'sel', quantity: null, unit: null },
    ]);
    expect(result[0].lines).toEqual([{ quantity: 10, unit: 'g', merged: false }]);
  });

  it('produit une ligne sans nombre quand aucune quantité n\'est connue', () => {
    const result = aggregateIngredients([
      { label: 'Poivre', quantity: null, unit: null },
      { label: 'poivre', quantity: null, unit: null },
    ]);
    expect(result[0].lines).toEqual([{ quantity: null, unit: null, merged: true }]);
  });

  it('trace les repas dont provient chaque ingrédient', () => {
    const result = aggregateIngredients([
      { label: 'Tomates', quantity: 400, unit: 'g', mealId: 'm1', mealTitle: 'Pâtes' },
      { label: 'Tomates', quantity: 200, unit: 'g', mealId: 'm2', mealTitle: 'Salade' },
    ]);
    expect(result[0].sources).toHaveLength(2);
    expect(result[0].sources.map((s) => s.mealTitle).sort()).toEqual(['Pâtes', 'Salade']);
  });

  it('retient la graphie la plus fréquente comme libellé affiché', () => {
    const result = aggregateIngredients([
      { label: 'Tomates', quantity: 1, unit: 'kg' },
      { label: 'Tomates', quantity: 1, unit: 'kg' },
      { label: 'tomate', quantity: 1, unit: 'kg' },
    ]);
    expect(result[0].label).toBe('Tomates');
  });

  it('retient le rayon majoritaire', () => {
    const result = aggregateIngredients([
      { label: 'Tomates', quantity: 1, unit: 'kg', aisle: 'fruits_legumes' },
      { label: 'tomates', quantity: 1, unit: 'kg', aisle: 'fruits_legumes' },
      { label: 'tomates', quantity: 1, unit: 'kg', aisle: 'autre' },
    ]);
    expect(result[0].aisle).toBe('fruits_legumes');
  });

  it('ignore les libellés vides', () => {
    expect(aggregateIngredients([{ label: '   ', quantity: 1, unit: 'kg' }])).toHaveLength(0);
  });

  it('rend une liste triée par libellé', () => {
    const result = aggregateIngredients([
      { label: 'Poireaux', quantity: 1, unit: 'kg' },
      { label: 'Ail', quantity: 1, unit: null },
      { label: 'Épinards', quantity: 1, unit: 'kg' },
    ]);
    expect(result.map((r) => r.label)).toEqual(['Ail', 'Épinards', 'Poireaux']);
  });
});

describe('détection du rayon', () => {
  it('classe les produits courants', () => {
    expect(guessAisle('Tomates cerises')).toBe('fruits_legumes');
    expect(guessAisle('Blanc de poulet')).toBe('boucherie_poissonnerie');
    expect(guessAisle('Yaourt nature')).toBe('frais');
    expect(guessAisle('Farine T55')).toBe('epicerie');
    expect(guessAisle('Baguette')).toBe('boulangerie');
    expect(guessAisle('Lessive')).toBe('maison');
  });

  it('retombe sur « autre » quand rien ne correspond', () => {
    expect(guessAisle('Bidule inconnu')).toBe('autre');
  });
});

describe('analyse d’une saisie libre (critère 3.3)', () => {
  it('lit « 2 kg de pommes » comme trois informations', () => {
    expect(parseQuickEntry('2 kg de pommes')).toEqual({
      quantity: 2,
      unit: 'kg',
      label: 'pommes',
    });
  });

  it('accepte la virgule décimale et les unités collées', () => {
    expect(parseQuickEntry('1,5 L de lait')).toEqual({ quantity: 1.5, unit: 'L', label: 'lait' });
    expect(parseQuickEntry('500g farine')).toEqual({ quantity: 500, unit: 'g', label: 'farine' });
  });

  it('reconnaît les unités de cuisine et leurs pluriels', () => {
    expect(parseQuickEntry('2 boîtes de tomates pelées')).toEqual({
      quantity: 2,
      unit: 'boîte',
      label: 'tomates pelées',
    });
  });

  it('ne prend pas le produit pour une unité', () => {
    // « citrons » n'est pas une unité : trois citrons, pas trois « citrons » de
    // quelque chose.
    expect(parseQuickEntry('3 citrons')).toEqual({ quantity: 3, unit: null, label: 'citrons' });
    expect(parseQuickEntry('6 œufs')).toEqual({ quantity: 6, unit: null, label: 'œufs' });
  });

  it('laisse intacte une saisie sans quantité', () => {
    expect(parseQuickEntry('pommes')).toEqual({ quantity: null, unit: null, label: 'pommes' });
    // On ne récrit pas le libellé de quelqu'un dans son dos : l'article n'est
    // retiré que derrière une unité.
    expect(parseQuickEntry('du pain')).toEqual({ quantity: null, unit: null, label: 'du pain' });
  });

  it('ne démonte pas un nom de produit qui contient un nombre', () => {
    // Une bière, pas une quantité sans produit.
    expect(parseQuickEntry('1664')).toEqual({ quantity: null, unit: null, label: '1664' });
    // Le nombre n'est pas en tête : il désigne le produit.
    expect(parseQuickEntry('Coca 33cl')).toEqual({
      quantity: null,
      unit: null,
      label: 'Coca 33cl',
    });
    // Une mesure sans produit reste le libellé, plutôt que de laisser « cl ».
    expect(parseQuickEntry('33cl')).toEqual({ quantity: null, unit: null, label: '33cl' });
    // Une fraction n'est pas une quantité décimale.
    expect(parseQuickEntry('1/2 baguette')).toEqual({
      quantity: null,
      unit: null,
      label: '1/2 baguette',
    });
  });

  it('tolère le vide et les espaces', () => {
    expect(parseQuickEntry('   ')).toEqual({ quantity: null, unit: null, label: '' });
    expect(parseQuickEntry('  2   kg   de   pommes ')).toEqual({
      quantity: 2,
      unit: 'kg',
      label: 'pommes',
    });
  });
});

describe('unités reconnues', () => {
  it('distingue une unité d’un produit', () => {
    expect(isKnownUnit('kg')).toBe(true);
    expect(isKnownUnit('Litres')).toBe(false); // pluriel non listé, volontairement
    expect(isKnownUnit('litre')).toBe(true);
    expect(isKnownUnit('citrons')).toBe(false);
    expect(isKnownUnit('')).toBe(false);
  });

  it('ne se laisse pas piéger par les propriétés héritées', () => {
    expect(isKnownUnit('constructor')).toBe(false);
    expect(isKnownUnit('toString')).toBe(false);
  });
});

describe('fusion de deux quantités (critère 3.4)', () => {
  it('additionne dans la même famille et choisit l’unité lisible', () => {
    expect(combineQuantities({ quantity: 2, unit: 'kg' }, { quantity: 500, unit: 'g' })).toEqual({
      quantity: 2.5,
      unit: 'kg',
    });
    expect(combineQuantities({ quantity: 3, unit: null }, { quantity: 2, unit: null })).toEqual({
      quantity: 5,
      unit: null,
    });
  });

  it('une quantité absente n’est pas zéro', () => {
    // Ajouter « pommes » à « 2 kg de pommes » ne retire rien : on sait déjà
    // combien il en faut.
    expect(combineQuantities({ quantity: 2, unit: 'kg' }, { quantity: null, unit: null })).toEqual({
      quantity: 2,
      unit: 'kg',
    });
    expect(combineQuantities({ quantity: null, unit: null }, { quantity: 2, unit: 'kg' })).toEqual({
      quantity: 2,
      unit: 'kg',
    });
  });

  it('refuse ce qui ne s’additionne pas', () => {
    expect(combineQuantities({ quantity: 1, unit: 'kg' }, { quantity: 1, unit: 'L' })).toBeNull();
    expect(
      combineQuantities({ quantity: 1, unit: 'sachet' }, { quantity: 1, unit: 'boîte' }),
    ).toBeNull();
  });
});
