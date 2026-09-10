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
 * Parcours 7 — l'honnêteté de l'écran Google Agenda.
 *
 * La règle posée au départ est simple : ne jamais afficher une synchronisation
 * réussie qui ne l'est pas. Ce parcours vérifie le cas le plus fréquent — une
 * installation où Google n'est pas configuré — parce que c'est justement là
 * qu'une interface complaisante mentirait.
 */

skipIfUnconfigured();

test.describe('Google Agenda', () => {
  let user: TestUser;

  test.beforeAll(async ({ admin }) => {
    user = await createUser(admin, 'google');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, user);
  });

  test('sans configuration, l’écran le dit et ne prétend rien', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Google ${Date.now()}`, 'Camille');

    await page.goto('/plus/google');

    const configure = Boolean(process.env.GOOGLE_CLIENT_ID);

    if (!configure) {
      // Il doit être écrit noir sur blanc que ce n'est pas configuré…
      await expect(page.getByText(/pas encore configuré|non configuré/i)).toBeVisible();
      // …et surtout, aucune promesse de synchronisation réussie.
      await expect(page.getByText(/synchronisation réussie|synchronisé le/i)).toHaveCount(0);
      await expect(page.getByText(/à jour|dernière synchronisation/i)).toHaveCount(0);
      return;
    }

    // Configuration présente : l'agenda n'est pas autorisé pour autant.
    // Se connecter avec Google et autoriser Google Agenda sont deux choses.
    await expect(page.getByRole('button', { name: /Connecter|Autoriser/i })).toBeVisible();
    await expect(page.getByText(/synchronisation réussie|synchronisé le/i)).toHaveCount(0);
  });

  test('la synchronisation ne s’invente pas un succès', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await page.goto('/plus/google');

    const bouton = page.getByRole('button', { name: /Synchroniser maintenant/i });
    if ((await bouton.count()) === 0) {
      // Rien à synchroniser tant qu'aucun agenda n'est autorisé : c'est le
      // comportement attendu, pas un test manquant.
      return;
    }

    await bouton.click();
    // Le résultat peut être un succès réel ou une erreur explicite — jamais un
    // silence qui laisse croire que tout va bien.
    await expect(
      page.getByText(/synchronisé|erreur|échec|non autorisé|non configuré/i).first(),
    ).toBeVisible();
  });
});
