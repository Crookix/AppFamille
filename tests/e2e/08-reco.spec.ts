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
 * Parcours 8 — les recommandations du foyer.
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

  test('un film s’ajoute, se déclare en envie, puis se marque « Vu »', async ({
    page,
    admin,
  }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Reco ${Date.now()}`, 'Camille');

    await page.goto('/reco');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).first().click();

    await page.getByRole('radio', { name: 'Film', exact: true }).click();
    await page.getByLabel(/Quoi ?/).fill('Petite maman');
    await page.getByLabel(/Pourquoi/).fill('Court et bouleversant.');
    await page.getByRole('button', { name: /^Ajouter$/ }).last().click();

    const fiche = page.getByText('Petite maman');
    await expect(fiche).toBeVisible();

    // Le vocabulaire du film, pas celui de la base.
    await expect(page.getByText('À voir').first()).toBeVisible();

    await page.getByRole('button', { name: /Moi aussi j’ai envie|envie/i }).first().click();
    await expect(page.getByRole('button', { name: /plus envie/i }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Vu', exact: true }).first().click();
    await expect(page.getByText('Vu').first()).toBeVisible();
  });

  test('une idée cadeau demande pour qui, et se marque « Offert »', async ({
    page,
    admin,
  }) => {
    await signIn(page, admin, user);
    await page.goto('/reco');

    await page.getByRole('button', { name: 'Ajouter', exact: true }).first().click();
    await page.getByRole('radio', { name: 'Idée cadeau' }).click();

    // Les champs du cadeau n'existent que pour un cadeau.
    await expect(page.getByText('Pour qui ?')).toBeVisible();

    await page.getByLabel(/Quoi ?/).fill('Microscope pour enfant');
    await page.getByLabel(/Destinataire/).fill('Mamie');
    await page.getByLabel(/Occasion/).fill('Noël');
    await page.getByLabel(/Prix/).fill('25,50');
    await page.getByRole('button', { name: /^Ajouter$/ }).last().click();

    await expect(page.getByText('Microscope pour enfant')).toBeVisible();
    await expect(page.getByText(/Pour Mamie/)).toBeVisible();
    await expect(page.getByText(/25,50/)).toBeVisible();
    // « Idée », pas « À voir » : le libellé suit le genre.
    await expect(page.getByText('Idée').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Offert', exact: true })).toBeVisible();
  });

  test('les onglets filtrent par genre', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await page.goto('/reco');

    await page.getByRole('tab', { name: /Idées cadeaux/ }).click();
    await expect(page.getByText('Microscope pour enfant')).toBeVisible();
    await expect(page.getByText('Petite maman')).toHaveCount(0);
  });
});
