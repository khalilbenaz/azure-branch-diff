import { test, expect, _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Captures du site et du README : exécuté seulement avec ABD_SHOTS=<dossier>.
const shots = process.env.ABD_SHOTS;
test.skip(!shots, 'ABD_SHOTS non défini');

test('captures : organisations, dossiers repliés, guide, thème sombre', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, AZ_FAKE: '1', ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-shots-')) },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  const shot = (name: string) => page.screenshot({ path: join(shots!, `${name}.png`) });
  const login = async (org: string) => {
    await page.locator('input[name="org"]').fill(org);
    await page.locator('input[name="pat"]').fill('x');
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Comparer' })).toBeVisible();
  };
  await login('https://dev.azure.com/contoso');
  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await page.getByRole('button', { name: /Ajouter|Nouvelle organisation/ }).first().click().catch(() => {});
  await login('https://dev.azure.com/fabrikam');
  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await expect(page.getByRole('list', { name: 'Organisations enregistrées' })).toBeVisible();
  await shot('08-orgs');

  await page.getByRole('button', { name: /Se connecter à .*contoso/ }).click();
  await page.getByLabel('Projet').selectOption('Demo');
  await page.getByLabel('Dépôt').selectOption('repo1');
  await page.getByLabel('Branche source').selectOption('feature/data');
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await page.getByRole('button', { name: /Service\.cs/ }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  await page.locator('.tree-dir').first().click();
  await page.waitForTimeout(500);
  await shot('09-folded');

  await page.locator('.tree-dir').first().click();
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole('group', { name: 'Thème' }).getByRole('button', { name: 'Sombre' }).click();
  await page.waitForTimeout(800);
  await shot('10-dark');
  await page.getByRole('group', { name: 'Thème' }).getByRole('button', { name: 'Clair' }).click();
  await page.waitForTimeout(400);

  await page.getByRole('tab', { name: 'Guide' }).click();
  await page.waitForTimeout(300);
  await shot('11-guide');

  // Bandeau des fichiers masqués : un dossier dont un fichier ne diffère que par des espaces.
  const dir = mkdtempSync(join(tmpdir(), 'abd-shots-ws-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/Service.cs'), 'public class Service\n{\n    // Export csv\n    public int Amount => 30;\n}\n');
  writeFileSync(join(dir, 'old.sql'), '\n   select    1;\r\n\r\n');
  writeFileSync(join(dir, 'big.sql'), 'small\n');
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, dir);
  await page.getByRole('tab', { name: 'Comparer' }).click();
  await page.getByRole('button', { name: 'Clone local' }).click();
  await page.getByRole('group', { name: 'Type de source' }).getByRole('button', { name: 'Local' }).click();
  await page.getByLabel('Référence source').selectOption('worktree');
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('espaces');
  await page.getByRole('button', { name: /Service\.cs/ }).click();
  await page.waitForTimeout(700);
  await shot('12-hidden');

  // Bandeau de mise à jour prête (état poussé par le processus principal).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', { kind: 'ready', version: '1.6.0' }));
  await page.waitForTimeout(300);
  await shot('13-update');
  await app.close();
});
