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
 * Parcours 10 — se déplacer dans l'application.
 *
 * La barre du bas a été repensée : cinq destinations, et « Plus » derrière la
 * pastille d'identité de l'entête. Ce parcours vérifie ce que des captures
 * d'écran ne prouvent pas — qu'on arrive bien quelque part en appuyant — et,
 * surtout, qu'aucun libellé n'est coupé ni relégué hors champ à 375 px.
 *
 * Le cas qui a motivé le travail est le 0.2 : un onglet qu'il faut faire
 * défiler pour découvrir n'existe pas pour qui ignore qu'il est là.
 */

skipIfUnconfigured();

test.describe.serial('Navigation', () => {
  let user: TestUser;

  test.beforeAll(async ({ admin }) => {
    user = await createUser(admin, 'navigation');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, user);
  });

  test('la barre porte cinq destinations, lisibles à 375 px', async ({ page, admin }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await signIn(page, admin, user);
    await createHousehold(page, `Navigation ${Date.now()}`, 'Camille');

    const barre = page.getByRole('navigation', { name: 'Navigation principale' });

    for (const nom of ['Accueil', 'Calendrier', 'Listes', 'Repas', 'Reco']) {
      await expect(barre.getByRole('link', { name: nom })).toBeVisible();
    }

    // « Plus » a quitté la barre du téléphone : c'est tout l'objet du
    // changement. S'il revenait, la reco retomberait dans le tiroir.
    await expect(barre.getByRole('link', { name: 'Plus' })).toBeHidden();

    // Aucun libellé tronqué, et rien qui déborde en largeur.
    const deborde = await page.evaluate(() => {
      const liens = [...document.querySelectorAll('nav[aria-label="Navigation principale"] a')];
      return {
        page: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        libelle: liens.some((a) => a.scrollWidth > a.clientWidth + 1),
      };
    });
    expect(deborde.page).toBe(false);
    expect(deborde.libelle).toBe(false);
  });

  test('les trois onglets de « Listes » tiennent d’un coup à 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto('/listes');

    const onglets = page.getByRole('tab');
    await expect(onglets).toHaveCount(3);
    await expect(page.getByRole('tab', { name: /Check-lists/ })).toBeVisible();

    const defile = await page.evaluate(() => {
      const tl = document.querySelector('[role="tablist"]');
      return tl ? tl.scrollWidth > tl.clientWidth + 1 : true;
    });
    expect(defile).toBe(false);
  });

  test('la pastille de l’entête mène à « Plus »', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto('/calendrier');

    await page.getByRole('link', { name: /Plus et réglages/ }).click();
    await expect(page).toHaveURL(/\/plus$/);
    await expect(page.getByRole('heading', { name: 'Plus' })).toBeVisible();

    // Le tiroir ne propose plus la reco : elle est dans la barre.
    await expect(page.getByRole('link', { name: /^Reco/ })).toHaveCount(0);
  });
});
