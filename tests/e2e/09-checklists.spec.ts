import {
  test,
  expect,
  createHousehold,
  createUser,
  deleteUser,
  signIn,
  skipIfUnconfigured,
  type TestUser,
} from './helpers';

/**
 * Parcours 9 — les check-lists.
 *
 * Ce qui distingue une check-list d'une liste de courses tient en un geste :
 * la remise à zéro. On vérifie donc le cycle entier — créer en collant une
 * liste, tout cocher, remettre à zéro — plutôt que la seule création.
 */

skipIfUnconfigured();

/**
 * Les deux parcours s'enchaînent : le second remet à zéro ce que le premier a
 * coché. Voir la note de `03-listes.spec.ts` sur le worker que Playwright jette
 * après un échec.
 */
test.describe.serial('Check-lists', () => {
  let user: TestUser;

  test.beforeAll(async ({ admin }) => {
    user = await createUser(admin, 'checklists');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, user);
  });

  test('une liste collée devient une check-list, et se coche', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Check-lists ${Date.now()}`, 'Camille');

    await page.goto('/listes?onglet=checklists');
    await page.getByRole('button', { name: /Nouvelle|Créer une check-list/i }).first().click();

    await page.getByLabel(/^Nom/).fill('La valise des enfants');
    // Collée telle qu'on la reçoit : tirets, numéros et doublon compris.
    await page.getByLabel(/Ce qu'elle contient/).fill(
      '- Doudou\n- Pyjama\n1. Brosse à dents\nDoudou',
    );

    // Les puces sont retirées et le doublon écarté : trois points, pas quatre.
    await expect(page.getByText(/3 points reconnus/)).toBeVisible();

    await page.getByRole('button', { name: /^Créer$/ }).click();

    await expect(page.getByText('La valise des enfants')).toBeVisible();
    await expect(page.getByText(/0 sur 3/)).toBeVisible();

    // Cocher : l'avancement suit.
    await page.getByRole('checkbox', { name: /Cocher Doudou/i }).click();
    await expect(page.getByText(/1 sur 3/)).toBeVisible();

    await page.getByRole('checkbox', { name: /Cocher Pyjama/i }).click();
    await page.getByRole('checkbox', { name: /Cocher Brosse à dents/i }).click();

    // Tout coché : la liste s'annonce prête.
    await expect(page.getByText('Prête')).toBeVisible();
  });

  test('la remise à zéro décoche tout sans perdre le contenu', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await page.goto('/listes?onglet=checklists');

    await page.getByRole('button', { name: /Remettre à zéro/i }).click();

    // Décoché, mais rien n'est perdu : c'est toute la différence avec une
    // liste de courses qu'on vide.
    await expect(page.getByText(/0 sur 3/)).toBeVisible();
    await expect(page.getByText('Doudou')).toBeVisible();
    await expect(page.getByText('Prête')).toHaveCount(0);

    // Et la date du dernier départ est notée.
    await expect(page.getByText(/remise à zéro/i)).toBeVisible();
  });
});
