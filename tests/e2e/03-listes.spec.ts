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
 * Parcours 3 — tâches et courses.
 *
 * Le point délicat n'est pas d'ajouter une ligne, c'est de ne pas en ajouter
 * deux : « 2 kg de pommes » puis « pommes » doivent fusionner.
 */

skipIfUnconfigured();

test.describe('Tâches et courses', () => {
  let user: TestUser;

  test.beforeAll(async ({ admin }) => {
    user = await createUser(admin, 'listes');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, user);
  });

  test('une tâche se crée, se coche, et se retrouve', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Listes ${Date.now()}`, 'Camille');

    await page.goto('/listes');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: /Une tâche/i }).click();

    await page.getByLabel(/Quoi ?/).fill('Prendre rendez-vous chez le dentiste');
    await page.getByRole('button', { name: /Ajouter|Enregistrer/i }).last().click();

    const tache = page.getByText('Prendre rendez-vous chez le dentiste');
    await expect(tache).toBeVisible();

    await page.getByRole('checkbox', { name: /dentiste/i }).first().check();
    await expect(page.getByRole('checkbox', { name: /dentiste/i }).first()).toBeChecked();
  });

  test('la saisie rapide devine quantité, unité et rayon', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await page.goto('/listes');

    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: /Une course/i }).click();
    await page.getByLabel(/^Article/).fill('2 kg de pommes');
    await page.getByRole('button', { name: /Ajouter/i }).last().click();

    await expect(page.getByText(/pommes/i).first()).toBeVisible();
    await expect(page.getByText(/2\s*kg/i).first()).toBeVisible();
    await expect(page.getByText(/Fruits et légumes/i).first()).toBeVisible();
  });

  test('ajouter le même produit fusionne au lieu de doubler', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await page.goto('/listes');

    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: /Une course/i }).click();
    await page.getByLabel(/^Article/).fill('1 kg de pommes');
    await page.getByRole('button', { name: /Ajouter/i }).last().click();

    // Une seule ligne « pommes », avec 3 kg au total.
    await expect(page.getByText(/pommes/i)).toHaveCount(1);
    await expect(page.getByText(/3\s*kg/i).first()).toBeVisible();
  });
});
