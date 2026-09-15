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

    // --- Une recette avec un ingrédient -------------------------------------
    await page.goto('/repas');
    await page.getByRole('button', { name: /^Recettes/ }).first().click();
    await page.getByRole('button', { name: /Nouvelle recette/i }).first().click();

    // Les libellés des champs requis portent un astérisque : leur nom
    // accessible est « Nom * », jamais « Nom ». D'où les expressions ancrées.
    await page.getByLabel(/^Nom/).fill('Gratin de courgettes');

    // La fiche s'ouvre AVEC une ligne d'ingrédient vide : cliquer « Ajouter un
    // ingrédient » en créerait une seconde, restée vide.
    //
    // Et surtout, on vise ici par `aria-label` et non par placeholder : le
    // champ du nom a pour placeholder « Gratin de courgettes », que
    // /Courgettes/i attrapait EN PREMIER. Le parcours remplissait donc le nom
    // de la recette avec « courgettes » puis s'étonnait de ne pas retrouver
    // « Gratin de courgettes ». C'était la cause de son échec, et elle ne
    // disait rien du produit.
    await page.getByLabel('Ingrédient 1', { exact: true }).fill('courgettes');
    await page.getByLabel(/^Quantité de/).first().fill('600');
    await page.getByLabel(/^Unité de/).first().fill('g');

    await page.getByRole('button', { name: /^Enregistrer$/ }).last().click();
    await expect(page.getByText('Gratin de courgettes').first()).toBeVisible();

    // --- Planifiée au dîner -------------------------------------------------
    await page.goto('/repas');
    await page.getByRole('button', { name: /^Soir/ }).first().click();

    // La recette se choisit dans une liste déroulante, pas par un bouton. On
    // prend sa valeur dans le DOM plutôt que son libellé, qui porte aussi le
    // nombre de portions et, pour une favorite, une étoile.
    const choixRecette = page.getByLabel(/^Recette/);
    const valeur = await page
      .locator('option', { hasText: 'Gratin de courgettes' })
      .first()
      .getAttribute('value');
    await choixRecette.selectOption(valeur ?? '');

    await page.getByRole('button', { name: /^Enregistrer$/ }).last().click();
    await expect(page.getByText('Gratin de courgettes').first()).toBeVisible();

    // --- Génération des courses, avec aperçu avant ajout --------------------
    // « Générer les courses » n'ouvre pas l'aperçu : il entre en mode
    // sélection, tous les repas à recette étant déjà retenus. C'est
    // « Continuer » qui ouvre l'aperçu.
    await page.getByRole('button', { name: /Générer les courses/i }).click();
    await page.getByRole('button', { name: /^Continuer$/ }).click();

    await expect(page.getByText(/courgettes/i).first()).toBeVisible();
    await page.getByRole('button', { name: /^Ajouter( \(\d+\))?$/ }).last().click();

    // L'écran « Listes » s'ouvre sur les tâches : il faut nommer l'onglet.
    await page.goto('/listes?onglet=courses');
    await expect(page.getByText(/courgettes/i).first()).toBeVisible();
  });
});
