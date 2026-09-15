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
    // Le tarif se saisit dans la fiche elle-même : il n'existe pas de bouton
    // « tarif » sur cet écran, contrairement à ce que ce parcours visait.
    await page.goto('/plus/nounous');
    await page.getByRole('button', { name: /Ajouter une nounou/i }).first().click();
    await page.getByLabel(/^Nom/).fill('Sofia');
    await page.getByLabel(/^Tarif horaire/).fill('12,50');
    await page.getByRole('button', { name: /^Enregistrer$/ }).last().click();

    // `Intl` sépare le montant de l'euro par une espace fine insécable : on ne
    // compare donc jamais une chaîne d'argent au caractère près.
    await expect(page.getByText(/12,50\s?€\/h/).first()).toBeVisible();

    // --- Une garde de deux heures, DÉJÀ PASSÉE ------------------------------
    // C'est le point que ce parcours manquait. L'écran ne propose de saisir des
    // heures que pour une garde TERMINÉE : `scheduled_end < maintenant`. Une
    // garde planifiée dans le futur va dans « Gardes à venir », où il n'y a ni
    // « Saisir » ni « Confirmer » — et le parcours cherchait un bouton qui ne
    // pouvait pas exister.
    //
    // Le bouton d'ajout, lui, s'appelle « Garde » et non « Ajouter une garde ».
    const debut = new Date(Date.now() - 3 * 3600_000);
    const fin = new Date(Date.now() - 1 * 3600_000);
    const local = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes(),
      ).padStart(2, '0')}`;

    await page.getByRole('button', { name: /^Garde$/ }).click();
    await page.getByLabel(/^Début prévu/).fill(local(debut));
    await page.getByLabel(/^Fin prévue/).fill(local(fin));
    await page.getByRole('button', { name: /^Planifier$/ }).click();

    // --- Les heures, saisies puis confirmées --------------------------------
    await page.goto('/plus/nounous');
    await expect(
      page.getByRole('heading', { name: /Heures à saisir ou confirmer/i }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^(Saisir|Confirmer)$/ }).first().click();

    await page.getByLabel(/^Arrivée réelle/).fill(local(debut));
    await page.getByLabel(/^Départ réel/).fill(local(fin));
    await page.getByRole('button', { name: /^Confirmer$/ }).last().click();

    // --- Confirmée, elle compte --------------------------------------------
    // Deux heures à 12,50 € : le bilan du mois de la garde doit porter 25,00 €.
    await page.getByRole('link', { name: /Sofia/ }).first().click();
    await expect(page).toHaveURL(/\/plus\/nounous\/[0-9a-f-]+$/);
    await page.goto(`${new URL(page.url()).pathname}?mois=${local(debut).slice(0, 7)}`);

    await expect(page.getByText(/25,00\s?€/).first()).toBeVisible();
  });

  test('le bilan mensuel s’exporte', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await page.goto('/plus/nounous');
    await page.getByRole('link', { name: /Sofia/ }).first().click();

    const telechargement = page.waitForEvent('download');
    // Le bouton s'appelle « Export CSV ».
    await page.getByRole('button', { name: /Export CSV/i }).first().click();
    const fichier = await telechargement;

    expect(fichier.suggestedFilename()).toMatch(/\.csv$/);
  });
});
