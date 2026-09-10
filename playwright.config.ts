import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

/**
 * Parcours de bout en bout, joués dans un vrai navigateur.
 *
 * Ces tests ont besoin de trois choses : une application qui tourne, un projet
 * Supabase joignable, et la clé `service_role` — cette dernière sert
 * uniquement à fabriquer des comptes de test et des liens de connexion, ce
 * qu'aucune interface ne permet de faire.
 *
 *   npm run dev            (dans un terminal)
 *   npm run test:e2e       (dans un autre)
 *
 * Sans configuration, chaque fichier s'annonce comme ignoré et explique ce qui
 * manque. Aucun test ne « passe » à vide : un parcours non joué est déclaré
 * non joué.
 */

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  // Les parcours créent des foyers distincts et ne se marchent pas dessus,
  // mais chacun bascule un état partagé (le foyer actif est un cookie) :
  // on garde un fichier à la fois pour que les échecs restent lisibles.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'bureau',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],

  // Démarre l'application si elle ne tourne pas déjà.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
