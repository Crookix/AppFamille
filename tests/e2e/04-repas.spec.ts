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
 * Parcours 4 — repas et génération des courses.
 *
 * La promesse : planifier la semaine, puis obtenir la liste de courses
 * correspondante sans la ressaisir.
 */

skipIfUnconfigured();

test.describe('Repas', () => {
  let user: TestUser;

  test.beforeAll(async ({ admin }) => {
    user = await createUser(admin, 'repas');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, user);
  });

  test('une recette planifiée alimente la liste de courses', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Repas ${Date.now()}`, 'Camille');

    // --- Une recette avec deux ingrédients ---------------------------------
    await page.goto('/repas');
    await page.getByRole('button', { name: /Recettes|Mes recettes/i }).first().click();
    await page.getByRole('button', { name: /Nouvelle recette|Ajouter une recette/i }).first().click();

    await page.getByLabel(/Nom|Titre/).first().fill('Gratin de courgettes');
    await page.getByRole('button', { name: /Ajouter un ingrédient/i }).click();
    await page.getByPlaceholder(/Ingrédient|Courgettes/i).first().fill('courgettes');
    await page.getByRole('button', { name: /Enregistrer/i }).last().click();

    await expect(page.getByText('Gratin de courgettes').first()).toBeVisible();

    // --- Planifiée au dîner -------------------------------------------------
    await page.goto('/repas');
    await page.getByRole('button', { name: /Soir/i }).first().click();
    await page.getByRole('button', { name: /Gratin de courgettes/i }).first().click();
    await page.getByRole('button', { name: /Enregistrer|Ajouter/i }).last().click();

    await expect(page.getByText('Gratin de courgettes').first()).toBeVisible();

    // --- Génération des courses, avec aperçu avant ajout --------------------
    await page.getByRole('button', { name: /Générer les courses|Faire les courses/i }).first().click();
    await expect(page.getByText(/courgettes/i).first()).toBeVisible();
    await page.getByRole('button', { name: /Ajouter à la liste|Confirmer/i }).last().click();

    await page.goto('/listes');
    await expect(page.getByText(/courgettes/i).first()).toBeVisible();
  });
});
