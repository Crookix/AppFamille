import type { ShopAisle } from '@/lib/database.types';

/**
 * Normalisation et regroupement des ingrédients.
 *
 * Objectif : « 400 g de tomates » et « 2 Tomates » doivent être reconnus comme
 * le même produit, mais ne peuvent pas être additionnés — leurs unités ne sont
 * pas convertibles. Le regroupement rassemble donc par produit, puis
 * n'additionne QUE ce qui est réellement additionnable, et laisse le reste sur
 * des lignes distinctes plutôt que d'inventer une conversion.
 */

/* -------------------------------------------------------------------------- */
/* Libellés                                                                   */
/* -------------------------------------------------------------------------- */

const LEADING_ARTICLES = /^(?:de\s+la\s+|de\s+l['’]|du\s+|des\s+|de\s+|d['’]|le\s+|la\s+|les\s+|l['’])/;

/**
 * Développe les ligatures avant toute autre normalisation.
 *
 * La décomposition Unicode NFD sépare une lettre de son accent, mais ne touche
 * pas aux ligatures : « œ » reste « œ ». Sans ce passage, « Œufs » et « oeufs »
 * resteraient deux produits distincts dans la liste de courses.
 */
function expandLigatures(text: string): string {
  return text
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE');
}

/**
 * Clé de regroupement d'un libellé : minuscules, sans accent, sans article,
 * sans ponctuation, au singulier approximatif.
 *
 * La singularisation est volontairement naïve (retrait d'un « s » final sur les
 * mots assez longs) : elle n'a pas besoin d'être juste linguistiquement, mais
 * d'être STABLE, pour que « tomate » et « tomates » tombent toujours ensemble.
 */
export function normalizeLabel(label: string): string {
  let text = expandLigatures(label)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,;:!?()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(LEADING_ARTICLES, '').trim();

  text = text
    .split(' ')
    .map((word) =>
      word.length > 4 && word.endsWith('s') && !word.endsWith('ss')
        ? word.slice(0, -1)
        : word,
    )
    .join(' ');

  return text;
}

/* -------------------------------------------------------------------------- */
/* Unités                                                                     */
/* -------------------------------------------------------------------------- */

export type UnitFamily = 'masse' | 'volume' | 'piece' | 'autre';

type UnitDefinition = {
  family: UnitFamily;
  /** Facteur vers l'unité de base de la famille (g, ml, pièce). */
  toBase: number;
  /** Forme affichée. */
  canonical: string;
};

const UNITS: Record<string, UnitDefinition> = {
  // Masse — base : le gramme
  g: { family: 'masse', toBase: 1, canonical: 'g' },
  gr: { family: 'masse', toBase: 1, canonical: 'g' },
  gramme: { family: 'masse', toBase: 1, canonical: 'g' },
  kg: { family: 'masse', toBase: 1000, canonical: 'kg' },
  kilo: { family: 'masse', toBase: 1000, canonical: 'kg' },
  kilogramme: { family: 'masse', toBase: 1000, canonical: 'kg' },

  // Volume — base : le millilitre
  ml: { family: 'volume', toBase: 1, canonical: 'ml' },
  millilitre: { family: 'volume', toBase: 1, canonical: 'ml' },
  cl: { family: 'volume', toBase: 10, canonical: 'cl' },
  centilitre: { family: 'volume', toBase: 10, canonical: 'cl' },
  dl: { family: 'volume', toBase: 100, canonical: 'dl' },
  l: { family: 'volume', toBase: 1000, canonical: 'L' },
  litre: { family: 'volume', toBase: 1000, canonical: 'L' },

  // Dénombrement
  piece: { family: 'piece', toBase: 1, canonical: 'pièce' },
  pieces: { family: 'piece', toBase: 1, canonical: 'pièce' },
  unite: { family: 'piece', toBase: 1, canonical: 'pièce' },
  u: { family: 'piece', toBase: 1, canonical: 'pièce' },
};

/**
 * Unités de cuisine délibérément NON converties.
 *
 * Une cuillère à soupe de farine et une cuillère à soupe d'huile ne pèsent pas
 * la même chose : convertir en grammes demanderait une table de densités par
 * ingrédient. On additionne donc « cuillère à soupe » avec « cuillère à soupe »,
 * et rien d'autre.
 */
const KITCHEN_UNITS: Record<string, string> = {
  'c a s': 'c. à s.',
  'c à s': 'c. à s.',
  cas: 'c. à s.',
  'cuillere a soupe': 'c. à s.',
  'cuilleres a soupe': 'c. à s.',
  'c a c': 'c. à c.',
  'c à c': 'c. à c.',
  cac: 'c. à c.',
  'cuillere a cafe': 'c. à c.',
  'cuilleres a cafe': 'c. à c.',
  pincee: 'pincée',
  pincees: 'pincée',
  sachet: 'sachet',
  sachets: 'sachet',
  boite: 'boîte',
  boites: 'boîte',
  gousse: 'gousse',
  gousses: 'gousse',
  botte: 'botte',
  bottes: 'botte',
  bouquet: 'bouquet',
  tranche: 'tranche',
  tranches: 'tranche',
  brin: 'brin',
  brins: 'brin',
  pot: 'pot',
  pots: 'pot',
  paquet: 'paquet',
  paquets: 'paquet',
};

export type ParsedUnit = {
  family: UnitFamily;
  canonical: string | null;
  toBase: number;
  /** Clé d'additionnabilité : deux lignes ne fusionnent que si elle coïncide. */
  groupKey: string;
};

/** Interprète une unité saisie librement. */
export function parseUnit(raw: string | null | undefined): ParsedUnit {
  const cleaned = (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    // Pas d'unité = un nombre de pièces sous-entendu (« 3 citrons »).
    return { family: 'piece', canonical: null, toBase: 1, groupKey: 'piece' };
  }

  const known = UNITS[cleaned];
  if (known) {
    return {
      family: known.family,
      canonical: known.canonical,
      toBase: known.toBase,
      groupKey: known.family,
    };
  }

  const kitchen = KITCHEN_UNITS[cleaned];
  if (kitchen) {
    return { family: 'autre', canonical: kitchen, toBase: 1, groupKey: `autre:${kitchen}` };
  }

  // Unité inconnue : conservée telle quelle, additionnable avec elle-même.
  return { family: 'autre', canonical: raw ?? null, toBase: 1, groupKey: `autre:${cleaned}` };
}

/** Deux unités peuvent-elles être additionnées ? */
export function unitsCompatible(a: string | null, b: string | null): boolean {
  return parseUnit(a).groupKey === parseUnit(b).groupKey;
}

/** Choisit l'unité d'affichage la plus lisible pour une quantité de base. */
function presentQuantity(
  family: UnitFamily,
  baseQuantity: number,
  fallbackUnit: string | null,
): { quantity: number; unit: string | null } {
  if (family === 'masse') {
    return baseQuantity >= 1000
      ? { quantity: round(baseQuantity / 1000), unit: 'kg' }
      : { quantity: round(baseQuantity), unit: 'g' };
  }
  if (family === 'volume') {
    return baseQuantity >= 1000
      ? { quantity: round(baseQuantity / 1000), unit: 'L' }
      : { quantity: round(baseQuantity), unit: 'ml' };
  }
  return { quantity: round(baseQuantity), unit: fallbackUnit };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Regroupement                                                               */
/* -------------------------------------------------------------------------- */

export type IngredientInput = {
  label: string;
  quantity: number | null;
  unit: string | null;
  aisle?: ShopAisle;
  /** Repas d'origine, pour tracer la provenance et pouvoir la retirer. */
  mealId?: string | null;
  mealTitle?: string | null;
  /** Coefficient de portions (nb de convives / portions de la recette). */
  scale?: number;
};

export type AggregatedLine = {
  quantity: number | null;
  unit: string | null;
  /** Vrai si cette ligne résulte de la fusion d'au moins deux apports. */
  merged: boolean;
};

export type AggregatedIngredient = {
  labelKey: string;
  label: string;
  aisle: ShopAisle;
  lines: AggregatedLine[];
  /** Repas qui ont contribué à cet ingrédient. */
  sources: { mealId: string | null; mealTitle: string | null }[];
};

/**
 * Regroupe une liste d'ingrédients issus de plusieurs repas.
 *
 * Les quantités sont d'abord mises à l'échelle du nombre de convives, puis
 * additionnées par produit ET par famille d'unité. Une ligne sans quantité
 * (« du sel ») n'annule pas les quantités des autres apports du même produit :
 * elle produit une ligne à part, sans nombre.
 */
export function aggregateIngredients(items: IngredientInput[]): AggregatedIngredient[] {
  type Bucket = {
    labelKey: string;
    labels: Map<string, number>;
    aisles: Map<ShopAisle, number>;
    byUnitGroup: Map<
      string,
      { family: UnitFamily; base: number; unit: string | null; count: number }
    >;
    /** Apports sans quantité chiffrée. */
    unquantified: number;
    sources: Map<string, { mealId: string | null; mealTitle: string | null }>;
  };

  const buckets = new Map<string, Bucket>();

  for (const item of items) {
    const labelKey = normalizeLabel(item.label);
    if (!labelKey) continue;

    let bucket = buckets.get(labelKey);
    if (!bucket) {
      bucket = {
        labelKey,
        labels: new Map(),
        aisles: new Map(),
        byUnitGroup: new Map(),
        unquantified: 0,
        sources: new Map(),
      };
      buckets.set(labelKey, bucket);
    }

    const trimmedLabel = item.label.trim();
    bucket.labels.set(trimmedLabel, (bucket.labels.get(trimmedLabel) ?? 0) + 1);

    const aisle = item.aisle ?? 'autre';
    bucket.aisles.set(aisle, (bucket.aisles.get(aisle) ?? 0) + 1);

    if (item.mealId || item.mealTitle) {
      bucket.sources.set(item.mealId ?? item.mealTitle ?? '', {
        mealId: item.mealId ?? null,
        mealTitle: item.mealTitle ?? null,
      });
    }

    if (item.quantity === null || item.quantity === undefined) {
      bucket.unquantified += 1;
      continue;
    }

    const scaled = item.quantity * (item.scale ?? 1);
    const unit = parseUnit(item.unit);
    const existing = bucket.byUnitGroup.get(unit.groupKey);

    if (existing) {
      existing.base += scaled * unit.toBase;
      existing.count += 1;
    } else {
      bucket.byUnitGroup.set(unit.groupKey, {
        family: unit.family,
        base: scaled * unit.toBase,
        unit: unit.canonical,
        count: 1,
      });
    }
  }

  const result: AggregatedIngredient[] = [];

  for (const bucket of buckets.values()) {
    const lines: AggregatedLine[] = [];

    for (const group of bucket.byUnitGroup.values()) {
      const presented = presentQuantity(group.family, group.base, group.unit);
      lines.push({ ...presented, merged: group.count > 1 });
    }

    if (bucket.unquantified > 0 && lines.length === 0) {
      lines.push({ quantity: null, unit: null, merged: bucket.unquantified > 1 });
    }

    result.push({
      labelKey: bucket.labelKey,
      label: mostFrequent(bucket.labels) ?? bucket.labelKey,
      aisle: mostFrequent(bucket.aisles) ?? 'autre',
      lines,
      sources: [...bucket.sources.values()],
    });
  }

  result.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return result;
}

function mostFrequent<T>(counts: Map<T, number>): T | null {
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Rayons                                                                     */
/* -------------------------------------------------------------------------- */

export const AISLE_LABELS: Record<ShopAisle, string> = {
  fruits_legumes: 'Fruits et légumes',
  boucherie_poissonnerie: 'Boucherie, poissonnerie',
  frais: 'Frais',
  epicerie: 'Épicerie',
  surgeles: 'Surgelés',
  boissons: 'Boissons',
  boulangerie: 'Boulangerie',
  maison: 'Maison',
  hygiene: 'Hygiène',
  bebe: 'Bébé',
  autre: 'Autre',
};

/** Ordre d'un parcours de magasin classique. */
export const AISLE_ORDER: ShopAisle[] = [
  'fruits_legumes',
  'boulangerie',
  'boucherie_poissonnerie',
  'frais',
  'surgeles',
  'epicerie',
  'boissons',
  'hygiene',
  'bebe',
  'maison',
  'autre',
];

const AISLE_HINTS: [ShopAisle, RegExp][] = [
  [
    'fruits_legumes',
    /\b(tomate|salade|pomme|banane|carotte|oignon|ail|courgette|poivron|citron|orange|fraise|champignon|epinard|brocoli|concombre|patate|pomme de terre|avocat|poireau|haricot vert|raisin|peche|poire|melon|radis|betterave|chou|navet|celeri|persil|basilic|coriandre|menthe)/,
  ],
  [
    'boucherie_poissonnerie',
    /\b(poulet|boeuf|porc|agneau|veau|dinde|saucisse|jambon|lardon|steak|escalope|saumon|cabillaud|thon|crevette|poisson|merlu|colin|viande|rôti|roti)/,
  ],
  [
    'frais',
    /\b(lait|beurre|creme|crème|yaourt|fromage|oeuf|œuf|emmental|gruyere|mozzarella|parmesan|comte|comté|chevre|chèvre|ricotta|feta|pate a|pâte à|pate feuilletee|pâte feuilletée|pate brisee)/,
  ],
  ['surgeles', /\b(surgele|surgelé|glace|petit pois surgel|frite surgel)/],
  [
    'boulangerie',
    /\b(pain|baguette|brioche|croissant|viennoiserie|biscotte)/,
  ],
  [
    'boissons',
    /\b(eau|jus|soda|vin|biere|bière|cafe|café|the|thé|sirop|limonade)/,
  ],
  [
    'epicerie',
    /\b(farine|sucre|sel|poivre|huile|vinaigre|riz|pate|pâte|pasta|semoule|lentille|pois chiche|conserve|tomate pelee|concentre|moutarde|mayonnaise|ketchup|epice|épice|levure|chocolat|miel|confiture|cereales|céréales|biscuit|bouillon|couscous|quinoa|noix|amande)/,
  ],
  ['hygiene', /\b(savon|shampoing|dentifrice|papier toilette|mouchoir|couche|coton)/],
  ['maison', /\b(lessive|liquide vaisselle|eponge|éponge|sac poubelle|essuie-tout|ampoule|pile)/],
  ['bebe', /\b(petit pot|lait infantile|lingette)/],
];

/** Devine le rayon d'un article à partir de son libellé. */
export function guessAisle(label: string): ShopAisle {
  const key = normalizeLabel(label);
  for (const [aisle, pattern] of AISLE_HINTS) {
    if (pattern.test(key)) return aisle;
  }
  return 'autre';
}

/** « 400 g », « 2 pièces », « 1,5 L » — ou rien si la quantité est absente. */
export function formatQuantity(
  quantity: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (quantity === null || quantity === undefined) return unit ?? '';
  const rounded = Math.round(quantity * 100) / 100;
  const text = rounded.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  if (!unit) return text;
  // Pas d'espace avant les unités très courtes accolées à l'usage.
  return `${text} ${unit}`;
}
