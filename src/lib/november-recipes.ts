import type { ShopAisle } from './database.types';

type MenuRecipe = {
  key: string;
  name: string;
  minutes: number;
  ingredients: [label: string, quantity: number, unit: string | null, aisle: ShopAisle][];
  steps: string[];
  children: string;
  ahead: string;
};

export const menuServings = 4;
export const familyPortions = 'Pour 2 adultes et 2 enfants, dont une petite portion.';
export const storageNote = 'Répartissez le plat dans des boîtes peu profondes et placez-les rapidement au réfrigérateur à 4 °C maximum. Servez la portion du tout-petit dans les 48 heures ou congelez-la le jour de la préparation.';

export const novemberRecipes: MenuRecipe[] = [
  {
    key: 'veloute-butternut',
    name: 'Velouté de butternut et lentilles corail',
    minutes: 35,
    ingredients: [
      ['Chair de butternut', 600, 'g', 'fruits_legumes'],
      ['Pommes de terre', 250, 'g', 'fruits_legumes'],
      ['Lentilles corail', 180, 'g', 'epicerie'],
      ['Petit oignon', 1, null, 'fruits_legumes'],
      ['Huile d’olive', 1, 'c. à s.', 'epicerie'],
      ['Eau', 900, 'ml', 'boissons'],
    ],
    steps: [
      'Émincez l’oignon et faites-le revenir doucement dans l’huile d’olive.',
      'Coupez la courge et les pommes de terre en petits cubes. Rincez les lentilles et ajoutez-les dans la casserole avec les légumes et l’eau.',
      'Laissez mijoter environ 25 min, jusqu’à ce que les légumes soient bien tendres.',
      'Mixez finement. Ajoutez un peu d’eau si vous préférez un velouté plus fluide.',
    ],
    children: 'Mixez jusqu’à obtenir une texture bien lisse. Prélevez la petite portion avant de saler.',
    ahead: 'Préparez entièrement le velouté. Il épaissit au frais. Réchauffez-le à la casserole avec un peu d’eau.',
  },
  {
    key: 'parmentier-carottes',
    name: 'Hachis parmentier bœuf-carottes',
    minutes: 50,
    ingredients: [
      ['Bœuf haché', 350, 'g', 'boucherie_poissonnerie'],
      ['Pommes de terre', 600, 'g', 'fruits_legumes'],
      ['Carottes', 500, 'g', 'fruits_legumes'],
      ['Petit oignon', 1, null, 'fruits_legumes'],
      ['Lait entier', 15, 'cl', 'frais'],
      ['Beurre', 20, 'g', 'frais'],
      ['Emmental râpé', 40, 'g', 'frais'],
      ['Huile d’olive', 1, 'filet', 'epicerie'],
    ],
    steps: [
      'Épluchez les carottes et les pommes de terre, coupez-les en petits morceaux et faites-les cuire à l’eau 20 à 25 min.',
      'Pendant ce temps, émincez l’oignon et faites-le revenir dans l’huile. Ajoutez le bœuf et faites-le cuire à cœur en l’émiettant. Préchauffez le four à 190 °C.',
      'Égouttez les légumes et écrasez-les avec le lait et le beurre.',
      'Étalez la viande dans un plat, recouvrez de purée et parsemez d’emmental. Faites gratiner environ 15 min à 190 °C.',
    ],
    children: 'Pour une purée plus lisse, mixez les carottes à part avant de les incorporer aux pommes de terre écrasées. Adaptez la part de viande du petit à son appétit et prélevez sa portion avant de saler.',
    ahead: 'Faites cuire le parmentier entièrement. Le jour du repas, réchauffez-le couvert à 180 °C pendant environ 25 à 30 min, jusqu’à ce que le centre soit bien chaud.',
  },
  {
    key: 'coquillettes-chou-fleur',
    name: 'Coquillettes au poulet, sauce crémeuse au chou-fleur',
    minutes: 35,
    ingredients: [
      ['Coquillettes sèches', 250, 'g', 'epicerie'],
      ['Poulet', 350, 'g', 'boucherie_poissonnerie'],
      ['Fleurettes de chou-fleur', 500, 'g', 'fruits_legumes'],
      ['Crème', 15, 'cl', 'frais'],
      ['Lait entier', 15, 'cl', 'frais'],
      ['Emmental râpé', 40, 'g', 'frais'],
      ['Huile d’olive', 1, 'filet', 'epicerie'],
    ],
    steps: [
      'Faites cuire les fleurettes de chou-fleur à l’eau ou à la vapeur environ 15 min, jusqu’à ce qu’elles soient très tendres.',
      'Mixez le chou-fleur avec la crème, l’emmental et 10 cl de lait. Ajoutez progressivement le reste du lait si nécessaire.',
      'Coupez le poulet en petits morceaux et faites-le cuire à cœur dans une poêle avec le filet d’huile.',
      'Faites cuire les coquillettes selon le temps indiqué sur le paquet, égouttez-les, puis mélangez-les avec le poulet et la sauce.',
    ],
    children: 'Vous pouvez servir le poulet à côté des pâtes. Coupez-le en petits morceaux fondants pour le plus jeune et prélevez sa portion avant de saler.',
    ahead: 'Gardez la sauce assez fluide. Le jour du repas, réchauffez doucement les coquillettes à la casserole avec un peu de lait en remuant.',
  },
];

export function menuNotes(recipe: MenuRecipe) {
  return [
    `Environ ${recipe.minutes} min. ${familyPortions}`,
    `Pour les enfants\n${recipe.children}`,
    `À J-2\n${recipe.ahead}`,
    storageNote,
  ].join('\n\n');
}
