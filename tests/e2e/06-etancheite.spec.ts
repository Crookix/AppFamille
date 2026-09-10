import {
  test,
  expect,
  createHousehold,
  createUser,
  deleteUser,
  signIn,
  signOut,
  skipIfUnconfigured,
  type TestUser,
} from './helpers';

/**
 * Parcours 6 — étanchéité entre foyers, vue depuis le navigateur.
 *
 * La vérification de fond se fait au niveau de la base
 * (`supabase/tests/isolation.sql`) : c'est là que la garantie est réelle,
 * puisqu'elle tient même si l'interface se trompe. Ce parcours-ci vérifie la
 * couche du dessus : qu'aucun écran, aucune URL devinée, aucun identifiant
 * recopié ne laisse filtrer quoi que ce soit.
 */

skipIfUnconfigured();

test.describe('Étanchéité entre foyers', () => {
  let camille: TestUser;
  let intrus: TestUser;

  test.beforeAll(async ({ admin }) => {
    camille = await createUser(admin, 'foyer-a');
    intrus = await createUser(admin, 'foyer-b');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, camille);
    await deleteUser(admin, intrus);
  });

  test('un membre d’un autre foyer ne voit rien, même en devinant les URL', async ({
    page,
    admin,
  }) => {
    // --- Foyer A, avec un enfant et un événement bien reconnaissables ------
    await signIn(page, admin, camille);
    await createHousehold(page, `Foyer A ${Date.now()}`, 'Camille');

    await page.goto('/plus/enfants');
    await page.getByRole('button', { name: /Ajouter un enfant|Nouvel enfant/i }).first().click();
    await page.getByLabel(/Prénom/i).first().fill('Léa-Secrète');
    await page.getByRole('button', { name: /Enregistrer|Ajouter/i }).last().click();
    await expect(page.getByText('Léa-Secrète').first()).toBeVisible();

    // On relève l'URL de la fiche : c'est ce qu'un curieux pourrait recopier.
    await page.getByText('Léa-Secrète').first().click();
    await page.waitForURL(/\/plus\/enfants\/[0-9a-f-]{36}/);
    const urlEnfant = new URL(page.url()).pathname;

    // --- Foyer B, monté par quelqu'un d'autre ------------------------------
    await signOut(page);
    await signIn(page, admin, intrus);
    await createHousehold(page, `Foyer B ${Date.now()}`, 'Intrus');

    // --- Il ne voit rien du foyer A ----------------------------------------
    for (const chemin of ['/', '/calendrier', '/listes', '/repas', '/plus/enfants']) {
      await page.goto(chemin);
      await expect(page.getByText('Léa-Secrète')).toHaveCount(0);
    }

    // --- Et l'URL recopiée ne s'ouvre pas ----------------------------------
    await page.goto(urlEnfant);
    await expect(page.getByText('Léa-Secrète')).toHaveCount(0);
  });
});
