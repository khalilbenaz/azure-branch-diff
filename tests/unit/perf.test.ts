import { test, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { fromAzureDiff } from '../../src/main/compare/fromAzureDiff';
import { compareLocalToAzure } from '../../src/main/compare/compareLocal';
import { toFileSide } from '../../src/main/azure/diff';
import { countLines } from '../../src/renderer/src/lib/eol';
import { blobSha } from '../../src/main/local/blobSha';
import { tempDir } from './helpers';

// Machines CI partagées (Windows surtout) : budgets ×3.
const F = process.env.CI ? 3 : 1;
// Budgets larges : ils détectent une régression d'un ordre de grandeur, pas une variation de machine.
function timed<T>(fn: () => T): [T, number] {
  const t = performance.now();
  const r = fn();
  return [r, performance.now() - t];
}

test('fromAzureDiff : 50 000 changements en moins de 1,5 s (suite en parallèle)', () => {
  const changes = Array.from({ length: 50000 }, (_, i) => ({ changeType: 2, item: { path: `/src/m${i % 50}/F${i}.cs`, gitObjectType: 3 } }));
  const [r, ms] = timed(() => fromAzureDiff(changes));
  expect(r).toHaveLength(50000);
  expect(ms).toBeLessThan(1500 * F);
});

test('toFileSide : fichier de 2 Mo en moins de 200 ms', () => {
  const buf = Buffer.from('é'.repeat(1024 * 1024));
  const [side, ms] = timed(() => toFileSide(buf));
  expect(side.lossy).toBe(false);
  expect(ms).toBeLessThan(200 * F);
});

test('countLines : 20 000 lignes avec 1 % de modifications en moins de 1 s', () => {
  const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n');
  const b = a
    .split('\n')
    .map((l, i) => (i % 100 === 0 ? `${l} changed` : l))
    .join('\n');
  const [r, ms] = timed(() => countLines(a, b));
  expect(r.added).toBe(200);
  expect(ms).toBeLessThan(1000 * F);
});

test('compareLocalToAzure : 3 000 fichiers dans un dépôt git en moins de 10 s', async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 3000; i++) files[`src/m${i % 30}/F${i}.cs`] = `class F${i} {}\n`;
  const root = tempDir(files);
  execSync('git init -q', { cwd: root });
  const remote = Object.entries(files).map(([path, c], i) => ({ path, objectId: i % 10 === 0 ? 'x'.repeat(40) : blobSha(Buffer.from(c)) }));
  const t = performance.now();
  const r = await compareLocalToAzure(root, remote);
  const ms = performance.now() - t;
  expect(r).toHaveLength(300);
  expect(ms).toBeLessThan(10000 * F);
}, 30000);
