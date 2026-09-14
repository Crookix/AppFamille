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

/**
 * Ces parcours s'enchaînent : chacun s'appuie sur ce que le précédent a créé.
 *
 * `serial` n'est pas un confort. Après un échec, Playwright jette le worker et
 * en démarre un neuf — `beforeAll` est donc rejoué et fabrique un AUTRE compte,
 * sans foyer. Les tests suivants échouaient alors sur « Créons votre foyer »,
 * pour une raison étrangère à ce qu'ils vérifient, et le rapport accusait cinq
 * défauts là où il n'y en avait qu'un. En série, ils sont sautés : on lit le
 * vrai.
 */
test.describe.serial('Tâches et courses', () => {
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

    // Cocher fait SORTIR la tâche de la liste : l'écran montre « à faire » ou
    // « terminées », jamais les deux. Vérifier qu'elle reste cochée sur place
    // reviendrait à vérifier qu'elle n'a pas été prise en compte.
    await page.getByRole('checkbox', { name: /dentiste/i }).first().click();
    await expect(tache).toHaveCount(0);

    await page.getByRole('button', { name: 'Terminées', exact: true }).click();
    await expect(tache.first()).toBeVisible();
  });

  test('la saisie rapide devine quantité, unité et rayon', async ({ page, admin }) => {
    await signIn(page, admin, user);
    // `/listes` s'ouvre sur les tâches : sans cet onglet, la course ajoutée
    // existe bien mais n'est pas à l'écran.
    await page.goto('/listes?onglet=courses');

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
    await page.goto('/listes?onglet=courses');

    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: /Une course/i }).click();
    await page.getByLabel(/^Article/).fill('1 kg de pommes');
    await page.getByRole('button', { name: /Ajouter/i }).last().click();

    // Une seule ligne « pommes », avec 3 kg au total.
    await expect(page.getByText(/pommes/i)).toHaveCount(1);
    await expect(page.getByText(/3\s*kg/i).first()).toBeVisible();
  });
});
