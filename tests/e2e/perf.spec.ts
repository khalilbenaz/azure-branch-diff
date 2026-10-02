import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Machines CI partagées (Windows surtout) : budgets ×3.
const F = process.env.CI ? 3 : 1;
// Budgets volontairement larges (machines CI) : ils détectent une régression d'un ordre de grandeur.
const BULK = 5000;

test('performance : démarrage, 5000 fichiers modifiés, filtre, ouverture d’un diff', async () => {
  const t0 = Date.now();
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, AZ_FAKE: '1', AZ_FAKE_BULK: String(BULK), ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-perf-')) },
  });
  const page = await app.firstWindow();
  await expect(page.getByLabel('Personal Access Token')).toBeVisible();
  const startup = Date.now() - t0;

  await page.getByLabel('Organisation').fill('https://dev.azure.com/demo');
  await page.getByLabel('Personal Access Token').fill('x');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByLabel('Projet').selectOption('Demo');
  await page.getByLabel('Dépôt').selectOption('repo1');
  await page.getByLabel('Branche source').selectOption('feature/data');

  let t = Date.now();
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${BULK} fichiers` })).toBeVisible();
  const compare = Date.now() - t;

  // Liste longue : rendu par tranches, avec « Afficher plus ».
  await expect(page.locator('.tree-file')).toHaveCount(500);
  await page.getByRole('button', { name: /Afficher les 500 suivants/ }).click();
  await expect(page.locator('.tree-file')).toHaveCount(1000);

  t = Date.now();
  await page.getByLabel('Filtrer les fichiers').fill('F04999');
  await expect(page.locator('.tree-file')).toHaveCount(1);
  const filter = Date.now() - t;

  t = Date.now();
  await page.locator('.tree-file').first().click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  const diff = Date.now() - t;

  console.log(JSON.stringify({ startupMs: startup, compare5000Ms: compare, filterMs: filter, openDiffMs: diff }));
  expect(startup).toBeLessThan(10000 * F);
  expect(compare).toBeLessThan(5000 * F);
  expect(filter).toBeLessThan(400 * F);
  expect(diff).toBeLessThan(3000 * F);
  await app.close();
});
