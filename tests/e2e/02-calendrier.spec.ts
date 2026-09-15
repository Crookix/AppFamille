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
 * Parcours 2 — le calendrier.
 *
 * On vérifie ce qui distingue un calendrier familial d'une liste de dates :
 * les récurrences, et le fait qu'on puisse déplacer UNE occurrence sans
 * bousculer la série.
 */

skipIfUnconfigured();

/**
 * Le premier jour du mois PROCHAIN, à 18 h.
 *
 * Le parcours de série comptait auparavant les occurrences d'une série
 * hebdomadaire créée « aujourd'hui », dans la vue du mois courant, et exigeait
 * au moins quatre. Le compte dépendait donc du jour où le test tournait : une
 * série lancée le 28 n'a que deux occurrences dans la grille, et le parcours
 * échouait — sans rien dire du produit.
 *
 * Ancré au 1er, il en a toujours au moins quatre : 1, 8, 15, 22, y compris en
 * février. Le mois prochain plutôt que le mois courant, pour que la série
 * commence dans le futur quel que soit le moment de l'exécution.
 */
function premierDuMoisProchain(): string {
  const maintenant = new Date();
  const suivant = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
  return suivant.toISOString().slice(0, 10);
}

const ANCRE = premierDuMoisProchain();

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
test.describe.serial('Calendrier', () => {
  let camille: TestUser;

  test.beforeAll(async ({ admin }) => {
    camille = await createUser(admin, 'calendrier');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, camille);
  });

  test.beforeEach(async ({ page, admin }) => {
    await signIn(page, admin, camille);
  });

  test('un événement simple apparaît dans les quatre vues', async ({ page }) => {
    await createHousehold(page, `Calendrier ${Date.now()}`, 'Camille');

    await page.goto('/calendrier');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: /Un événement/i }).click();

    await page.getByLabel(/^Titre/).fill('Pédiatre');
    await page.getByRole('button', { name: /^Ajouter$/ }).last().click();

    // Le sélecteur de vue est un `tablist` : ses quatre entrées portent le
    // rôle `tab`, pas `button`.
    for (const vue of ['Agenda', 'Jour', 'Semaine', 'Mois']) {
      await page.getByRole('tab', { name: vue, exact: true }).click();
      await expect(page.getByText('Pédiatre').first()).toBeVisible();
    }
  });

  test('une série hebdomadaire produit plusieurs occurrences', async ({ page }) => {
    await page.goto('/calendrier');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: /Un événement/i }).click();

    await page.getByLabel(/^Titre/).fill('Piscine');
    // La série démarre le 1er du mois prochain : voir la note sur ANCRE.
    await page.getByLabel(/^Début/).fill(`${ANCRE}T18:00`);

    // Le formulaire ne montre d'abord que l'essentiel ; la répétition vit dans
    // la section qu'on déplie.
    await page.getByRole('button', { name: /Lieu, responsable, répétition/i }).click();
    // Par valeur et non par libellé : le libellé est du texte d'interface, la
    // valeur est le contrat.
    await page.getByLabel(/^Répétition/).selectOption('hebdomadaire');
    await page.getByRole('button', { name: /^Ajouter$/ }).last().click();

    // Dans le mois de l'ancre, une série hebdomadaire partie du 1er se voit
    // les 1, 8, 15 et 22 au minimum.
    await page.goto(`/calendrier?vue=mois&date=${ANCRE}`);
    await expect(page.getByText('Piscine').first()).toBeVisible();
    expect(await page.getByText('Piscine').count()).toBeGreaterThanOrEqual(4);
  });

  test('modifier une occurrence ne touche pas les autres', async ({ page }) => {
    await page.goto(`/calendrier?vue=mois&date=${ANCRE}`);

    const occurrences = page.getByText('Piscine');
    const avant = await occurrences.count();
    expect(avant).toBeGreaterThanOrEqual(2);

    await occurrences.first().click();
    await page.getByRole('button', { name: /Modifier/i }).first().click();
    await page.getByLabel(/^Titre/).fill('Piscine (annulée)');
    await page.getByRole('button', { name: /Enregistrer/i }).last().click();

    // Si le choix « cette occurrence / toute la série » est proposé, on prend
    // cette occurrence seule.
    const seule = page.getByRole('button', { name: /Cette occurrence|Uniquement/i });
    if (await seule.count()) await seule.first().click();

    await expect(page.getByText('Piscine (annulée)')).toHaveCount(1);
    expect(await page.getByText(/^Piscine$/).count()).toBe(avant - 1);
  });
});
