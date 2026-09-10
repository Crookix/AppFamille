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
 * Parcours 1 — un foyer se monte, un second adulte le rejoint.
 *
 * C'est le parcours d'entrée du produit : sans lui, rien d'autre n'existe.
 * On y vérifie aussi ce que l'invitation ne doit PAS faire — laisser entrer
 * deux fois, ou laisser deviner le contenu d'un foyer avant l'acceptation.
 */

skipIfUnconfigured();

test.describe('Foyer et invitations', () => {
  let camille: TestUser;
  let alex: TestUser;

  test.beforeAll(async ({ admin }) => {
    camille = await createUser(admin, 'camille');
    alex = await createUser(admin, 'alex');
  });

  test.afterAll(async ({ admin }) => {
    await deleteUser(admin, camille);
    await deleteUser(admin, alex);
  });

  test('un adulte crée son foyer, invite le second, qui le rejoint', async ({
    page,
    admin,
  }) => {
    // --- Camille monte le foyer -------------------------------------------
    await signIn(page, admin, camille);
    const foyer = `Foyer E2E ${Date.now()}`;
    await createHousehold(page, foyer, 'Camille');

    await expect(page.getByText(foyer).first()).toBeVisible();

    // --- Elle déclare un enfant -------------------------------------------
    await page.goto('/plus/enfants');
    await page.getByRole('button', { name: /Ajouter un enfant|Nouvel enfant/i }).first().click();
    await page.getByLabel(/Prénom/i).first().fill('Léa');
    await page.getByRole('button', { name: /Enregistrer|Ajouter/i }).last().click();
    await expect(page.getByText('Léa').first()).toBeVisible();

    // --- Elle fabrique un lien d'invitation --------------------------------
    await page.goto('/plus/foyer');
    await page.getByRole('button', { name: /Inviter un adulte/i }).click();
    await page.getByRole('button', { name: /Créer un lien d'invitation/i }).click();

    const lien = await page
      .locator('p.font-mono')
      .first()
      .innerText({ timeout: 15_000 });

    expect(lien).toContain('/invitation/');

    // Le lien n'est montré qu'une fois : la base ne doit en garder que
    // l'empreinte. On le vérifie directement, la promesse est trop importante
    // pour n'être qu'un commentaire dans le code.
    const jeton = lien.split('/invitation/')[1];
    const { data: invitations } = await admin
      .from('invitations')
      .select('token_hash')
      .limit(50);
    expect(
      (invitations ?? []).some((i: { token_hash: string }) => i.token_hash === jeton),
    ).toBe(false);

    // --- Alex ouvre le lien ------------------------------------------------
    await signOut(page);
    await signIn(page, admin, alex);
    await page.goto(new URL(lien).pathname);

    // L'aperçu nomme le foyer et l'inviteuse, et rien de plus.
    await expect(page.getByText(foyer)).toBeVisible();
    await expect(page.getByText('Léa')).toHaveCount(0);

    await page.getByRole('button', { name: /Rejoindre|Accepter/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/invitation'), {
      timeout: 20_000,
    });

    // --- Maintenant, et seulement maintenant, il voit le foyer -------------
    await page.goto('/plus/enfants');
    await expect(page.getByText('Léa').first()).toBeVisible();

    // --- Le même lien ne sert pas deux fois --------------------------------
    await signOut(page);
    const tiers = await createUser(admin, 'tiers');
    try {
      await signIn(page, admin, tiers);
      await page.goto(new URL(lien).pathname);
      await expect(
        page.getByText(/déjà été utilisée|déjà utilisée/i),
      ).toBeVisible();
    } finally {
      await deleteUser(admin, tiers);
    }
  });

  test('un jeton inventé ne révèle rien', async ({ page, admin }) => {
    await signIn(page, admin, alex);
    await page.goto('/invitation/jeton-completement-invente-au-hasard');

    await expect(page.getByText(/invalide|introuvable/i)).toBeVisible();
    // Surtout : aucun nom de foyer ne doit apparaître.
    await expect(page.getByText(/Foyer E2E/)).toHaveCount(0);
  });
});
