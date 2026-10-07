import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

let app: ElectronApplication;
let page: Page;
const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const write = (dir: string, p: string, c: string) => {
  mkdirSync(dirname(join(dir, p)), { recursive: true });
  writeFileSync(join(dir, p), c);
};

/** origin nu + clone : release et feature/data modifient la même ligne. */
function repoWithConflict() {
  const base = mkdtempSync(join(tmpdir(), 'abd-e2e-merge-'));
  const bare = join(base, 'origin.git');
  git(base, 'init', '-q', '--bare', '-b', 'master', bare);
  const seed = join(base, 'seed');
  git(base, 'init', '-q', '-b', 'master', seed);
  for (const d of [seed]) {
    git(d, 'config', 'user.email', 't@example.com');
    git(d, 'config', 'user.name', 'T');
  }
  write(seed, 'src/Service.cs', 'class Service\n{\n    int Amount = 10;\n}\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'init');
  git(seed, 'remote', 'add', 'origin', bare);
  git(seed, 'push', '-q', 'origin', 'master');
  git(seed, 'checkout', '-q', '-b', 'release');
  write(seed, 'src/Service.cs', 'class Service\n{\n    int Amount = 20;\n}\n');
  git(seed, 'commit', '-q', '-am', 'release');
  git(seed, 'push', '-q', 'origin', 'release');
  git(seed, 'checkout', '-q', '-b', 'feature/data', 'master');
  write(seed, 'src/Service.cs', 'class Service\n{\n    int Amount = 30;\n}\n');
  git(seed, 'commit', '-q', '-am', 'feature');
  git(seed, 'push', '-q', 'origin', 'feature/data');
  git(base, 'clone', '-q', bare, 'clone');
  const clone = join(base, 'clone');
  git(clone, 'config', 'user.email', 't@example.com');
  git(clone, 'config', 'user.name', 'T');
  git(clone, 'branch', 'release', 'origin/release');
  return { bare, clone };
}

const AXE = readFileSync(createRequire(__filename).resolve('axe-core/axe.min.js'), 'utf8');
async function a11y() {
  await page.evaluate(AXE);
  const v = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: { id: string; impact: string | null }[] }> } }).axe;
    const r = await axe.run({ exclude: [['.monaco-editor']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
    return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => x.id);
  });
  expect(v).toEqual([]);
}

test.beforeAll(async () => {
  app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, AZ_FAKE: '1', ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-merge-ui-')) } });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  page.on('dialog', (d) => d.accept());
});
test.afterAll(async () => app?.close());

test('merge local → local avec conflit résolu dans l’app, commit puis push', async () => {
  const { bare, clone } = repoWithConflict();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    // Confirmation native du push (boutons « Pousser / Annuler ») : « Pousser ». Les autres boîtes restent intactes.
    const original = dialog.showMessageBox.bind(dialog);
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const opts = (args.length > 1 ? args[1] : args[0]) as { buttons?: string[] };
      if (opts?.buttons?.includes('Pousser')) return { response: 0, checkboxChecked: false };
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as typeof dialog.showMessageBox;
  }, clone);

  await page.getByLabel('Organisation').fill('https://dev.azure.com/demo');
  await page.getByLabel('Personal Access Token').fill('x');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('button', { name: 'Clone local' }).click();
  await expect(page.getByRole('button', { name: 'Clone local' })).toContainText('clone');

  await page.getByRole('group', { name: 'Type de source' }).getByRole('button', { name: 'Local' }).click();
  await page.getByLabel('Référence source').selectOption('remote:feature/data');
  await page.getByRole('group', { name: 'Type de cible' }).getByRole('button', { name: 'Local' }).click();
  await page.getByLabel('Référence cible').selectOption('branch:release');

  // Comparaison local ↔ local d'abord
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await page.getByRole('button', { name: /Service\.cs/ }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();

  await page.getByRole('button', { name: 'Fusionner' }).click();
  await expect(page.getByRole('tab', { name: /Merge local/ })).toHaveAttribute('aria-selected', 'true');
  const list = page.getByRole('list', { name: 'Conflits du merge' });
  await expect(list.getByText('src/Service.cs')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer la fusion' })).toBeDisabled();
  await expect(page.locator('.merge-head')).toContainText('Fusionner feature/data dans release');
  await expect(page.getByRole('list', { name: 'Étapes de la fusion' }).locator('[aria-current="step"]')).toContainText('Régler les conflits (1)');
  await a11y();

  // Le premier conflit s'ouvre tout seul, présenté bloc par bloc, sans marqueurs git à éditer.
  const block = page.getByLabel('Conflit en cours');
  await expect(block).toContainText('Conflit 1 sur 1');
  await expect(block).toContainText('Amount = 20');
  await expect(block).toContainText('Amount = 30');
  await a11y();
  await page.screenshot({ path: process.env.ABD_SHOTS ? join(process.env.ABD_SHOTS, '07-merge.png') : join(tmpdir(), 'abd-07-merge.png') });
  await block.getByRole('button', { name: 'Garder feature/data' }).click();
  await expect(page.getByText('Tous les conflits de ce fichier sont réglés.')).toBeVisible();
  await page.getByRole('button', { name: 'Valider ce fichier' }).click();
  await expect(list.getByText('✓ Réglé')).toBeVisible();

  await page.getByRole('button', { name: 'Enregistrer la fusion' }).click();
  await expect(page.getByText('✓ feature/data est fusionné dans release.')).toBeVisible();
  await expect(page.getByText(/pas encore sur Azure/)).toBeVisible();
  expect(git(clone, 'show', 'release:src/Service.cs')).toContain('Amount = 30');
  expect(git(clone, 'log', '-1', '--format=%s', 'release')).toBe('Merge feature/data into release');
  expect(git(clone, 'status', '--porcelain')).toBe(''); // copie de travail intacte

  await page.getByRole('button', { name: 'Envoyer release sur Azure' }).click();
  await expect(page.getByText(/envoyée sur Azure/)).toBeVisible();
  expect(git(bare, 'rev-parse', 'release')).toBe(git(clone, 'rev-parse', 'release'));
  await page.getByRole('button', { name: 'Terminer' }).click();
  await expect(page.getByText('Aucune fusion en cours')).toBeVisible();
});
