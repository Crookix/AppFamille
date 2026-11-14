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
 * Parcours 8 — les recommandations du foyer (un genre = une liste simple).
 *
 * Ce qui mérite d'être vérifié en navigateur n'est pas l'enregistrement, que
 * les tests unitaires couvrent déjà, mais deux promesses de l'écran : le
 * vocabulaire suit le genre — on ne dit pas « fait » d'un film mais « vu », et
 * « offert » d'un cadeau — et les champs du cadeau n'apparaissent que pour un
 * cadeau.
 */

skipIfUnconfigured();

test.describe('Reco', () => {
  let user: TestUser;

  test.beforeAll(async ({ admin }) => {
    user = await createUser(admin, 'reco');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, user);
  });

  test('un genre ouvre sa liste, où un film s’ajoute et se coche « Vu »', async ({
    page,
    admin,
  }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Reco ${Date.now()}`, 'Camille');

    // L'accueil ne montre que les genres ; un appui ouvre la seule liste.
    await page.goto('/reco');
    await page.getByRole('link', { name: /Films/ }).click();
    await expect(page.getByRole('heading', { name: 'Films' })).toBeVisible();

    await page.getByLabel(/Ajouter à la liste/).fill('Petite maman');
    await page.getByLabel(/Ajouter à la liste/).press('Enter');
    await expect(page.getByText('Petite maman')).toBeVisible();

    // Le vocabulaire du film, pas celui de la base : « Vu », pas « fait ».
    await page.getByRole('checkbox', { name: /Vu : Petite maman/ }).click();
    await expect(page.getByRole('button', { name: /Vu \(1\)/ })).toBeVisible();
  });

  test('une liste ne montre que son genre', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await page.goto('/reco?genre=cadeau');

    await page.getByLabel(/Ajouter à la liste/).fill('Microscope pour enfant');
    await page.getByLabel(/Ajouter à la liste/).press('Enter');
    await expect(page.getByText('Microscope pour enfant')).toBeVisible();
    await expect(page.getByText('Petite maman')).toHaveCount(0);
  });
});
