import { test, expect, createHousehold, createUser, deleteUser, signIn, skipIfUnconfigured, type TestUser } from './helpers';

skipIfUnconfigured();

test.describe('Carnet et planning des repas', () => {
  let user: TestUser;

  test.beforeEach(async ({ admin }) => { user = await createUser(admin, 'repas'); });
  test.afterEach(async ({ admin }) => { await deleteUser(admin, user); });

  test('conserver les trois fiches, planifier une recette et en tirer les courses', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Repas ${Date.now()}`, 'Camille');

    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await nav.getByRole('link', { name: 'Recette', exact: true }).click();
    await page.getByRole('link', { name: 'Les 3 recettes de novembre' }).click();
    await page.getByRole('button', { name: 'Ajouter les 3 recettes au foyer' }).click();

    const soup = 'Velouté de butternut et lentilles corail';
    await expect(page.getByRole('link', { name: /Hachis parmentier/ })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /Coquillettes au poulet/ })).toHaveCount(1);
    await page.getByRole('link', { name: new RegExp(soup) }).click();
    await expect(page.getByText('180 g', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Préparation' })).toBeVisible();
    await expect(page.getByText(/À J-2/)).toBeVisible();

    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('textbox', { name: 'Quantité de Lentilles corail' }).fill('160');
    await editor.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('160 g', { exact: true })).toBeVisible();
    await expect(page.getByText(/À J-2/)).toBeVisible();

    await page.goto('/recettes/selection-novembre');
    await page.getByRole('button', { name: 'Ajouter les 3 recettes au foyer' }).click();
    const soupLink = page.getByRole('link', { name: new RegExp(soup) });
    await expect(soupLink).toHaveCount(1);
    await soupLink.click();
    await expect(page.getByText('160 g', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Planifier un repas' }).click();
    await page.getByRole('button', { name: 'Semaine suivante' }).click();
    await expect(page).toHaveURL(/[?&]semaine=/);
    await expect(page.getByText(/Choisissez un repas pour/)).toContainText(soup);
    await page.getByRole('button', { name: /Dîner Ajouter/ }).first().click();
    const meal = page.getByRole('dialog');
    await expect(meal.getByLabel('Au menu', { exact: false })).toHaveValue(soup);
    await meal.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('button', { name: new RegExp(soup) })).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]recette=/);
    const week = page.url();
    await page.getByRole('link', { name: 'Voir la recette' }).click();
    await expect(page.getByRole('heading', { name: soup })).toBeVisible();

    await page.goto(week);
    await page.getByRole('button', { name: 'Générer les courses' }).click();
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Ajouter aux courses' });
    await expect(preview.getByRole('checkbox', { name: 'Ne pas ajouter Lentilles corail' })).toBeChecked();
    await expect(preview.getByText('160 g', { exact: true })).toBeVisible();
    await preview.getByRole('button', { name: /^Ajouter \(6\)$/ }).click();
    await expect(preview).toBeHidden();
    await page.goto('/listes?onglet=courses');
    await expect(page.getByRole('checkbox', { name: 'Cocher Lentilles corail' })).toBeVisible();
  });
  test('associer une recette maison depuis un repas déjà saisi', async ({ page, admin }) => {
    await signIn(page, admin, user);
    await createHousehold(page, `Carnet ${Date.now()}`, 'Camille');
    await page.goto('/recettes');
    await page.getByRole('button', { name: 'Nouvelle recette' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(/^Nom/).fill('Gratin de courgettes');
    await sheet.getByRole('textbox', { name: 'Ingrédient 1', exact: true }).fill('Courgettes');
    await sheet.getByLabel(/^Étapes/).fill('Faire cuire les courgettes.');
    await sheet.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('link', { name: /Gratin de courgettes/ })).toBeVisible();

    await page.goto('/repas');
    await page.getByRole('button', { name: /Déjeuner Ajouter/ }).first().click();
    await sheet.getByLabel(/Au menu/).fill('Déjeuner à la maison');
    await sheet.getByRole('button', { name: 'Enregistrer' }).click();

    await page.getByRole('button', { name: /Déjeuner à la maison/ }).click();
    await sheet.getByLabel(/^Recette/).selectOption({ label: 'Gratin de courgettes (4 pers.)' });
    await sheet.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByRole('link', { name: 'Voir la recette' }).click();
    await expect(page.getByRole('heading', { name: 'Gratin de courgettes' })).toBeVisible();
    await expect(page.getByText('Faire cuire les courgettes.', { exact: true })).toBeVisible();
  });
});
