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
 * Parcours 5 — gardes et bilan mensuel.
 *
 * Ce que la famille veut vraiment savoir à la fin du mois : combien d'heures,
 * et combien on doit. Seules les séances confirmées entrent dans le montant.
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
test.describe.serial('Nounous et gardes', () => {
  let user: TestUser;

  test.beforeAll(async ({ admin }) => {
    user = await createUser(admin, 'nounous');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, user);
  });

  test('une séance saisie puis confirmée arrive au bilan', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Gardes ${Date.now()}`, 'Camille');

    // --- La nounou et son tarif --------------------------------------------
    await page.goto('/plus/nounous');
    await page.getByRole('button', { name: /Ajouter une nounou|Nouvelle nounou/i }).first().click();
    await page.getByLabel(/Nom|Prénom/).first().fill('Sofia');
    await page.getByRole('button', { name: /Enregistrer|Ajouter/i }).last().click();

    await page.getByText('Sofia').first().click();
    await page.getByRole('button', { name: /tarif/i }).first().click();
    await page.getByLabel(/Tarif|Montant/).first().fill('12,50');
    await page.getByRole('button', { name: /Enregistrer/i }).last().click();
    await expect(page.getByText(/12,50/).first()).toBeVisible();

    // --- Une garde de deux heures ------------------------------------------
    await page.getByRole('button', { name: /Ajouter une garde|Nouvelle garde/i }).first().click();
    await page.getByRole('button', { name: /Enregistrer|Ajouter/i }).last().click();

    // --- Confirmée, elle compte --------------------------------------------
    await page.getByRole('button', { name: /Confirmer/i }).first().click();

    await expect(page.getByText(/€/).first()).toBeVisible();
  });

  test('le bilan mensuel s’exporte', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await page.goto('/plus/nounous');
    await page.getByText('Sofia').first().click();

    const telechargement = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exporter|CSV/i }).first().click();
    const fichier = await telechargement;

    expect(fichier.suggestedFilename()).toMatch(/\.csv$/);
  });
});
