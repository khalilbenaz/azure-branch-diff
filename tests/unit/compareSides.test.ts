import { test, expect } from 'vitest';
import { realpathSync } from 'node:fs';
import { compareSides, sidesContent } from '../../src/main/compare/compareSides';
import { compareTrees } from '../../src/main/compare/compareLocal';
import { localTree } from '../../src/main/local/repo';
import { fakeContext } from '../../src/main/azure/fake';
import { normalizeError } from '../../src/main/errors';
import type { AzureSource, LocalSide } from '../../src/shared/types';
import { makeOrigin, git, writeFile, commitFile } from './gitFixtures';

const AZ_MASTER: AzureSource = { kind: 'azure', project: 'Demo', repoId: 'repo1', branch: 'master' };
const AZ_FEATURE: AzureSource = { kind: 'azure', project: 'Demo', repoId: 'repo1', branch: 'feature/data' };
const local = (root: string, ref: LocalSide['ref']): LocalSide => ({ kind: 'local', root: realpathSync.native(root), ref });

test('compareTrees : ajout, suppression, modification, inchangé', () => {
  expect(
    compareTrees(
      [{ path: 'a', objectId: '1' }, { path: 'b', objectId: '2' }, { path: 'same', objectId: '9' }],
      [{ path: 'b', objectId: '3' }, { path: 'c', objectId: '4' }, { path: 'same', objectId: '9' }],
    ).map((c) => [c.path, c.change]),
  ).toEqual([['a', 'delete'], ['b', 'edit'], ['c', 'add']]);
});

test('localTree : blobs d’une référence avec leur SHA', async () => {
  const { clone } = makeOrigin();
  const items = await localTree(clone, { type: 'remote', name: 'feature/data' });
  expect(items.map((i) => i.path)).toEqual(['README.md', 'src/Data.cs', 'src/Service.cs']);
  expect(items[0].objectId).toBe(git(clone, 'rev-parse', 'origin/feature/data:README.md'));
});

test('local ↔ local : diff et contenu (gauche = cible, droite = source)', async () => {
  const { clone } = makeOrigin();
  const src = local(clone, { type: 'remote', name: 'feature/data' });
  const tgt = local(clone, { type: 'branch', name: 'master' });
  const cmp = await compareSides(null, src, tgt, 'mergeBase');
  expect(cmp.kind).toBe('local');
  expect(cmp.changes.map((c) => c.path)).toEqual(['src/Data.cs', 'src/Service.cs']);
  const svc = cmp.changes.find((c) => c.path === 'src/Service.cs')!;
  const sides = await sidesContent(null, src, tgt, svc, cmp);
  expect(sides.left.content).toContain('Amount = 10');
  expect(sides.right.content).toContain('Amount = 30');
});

test('local ↔ local : copie de travail comme source', async () => {
  const { clone } = makeOrigin();
  writeFile(clone, 'src/Service.cs', 'wip\n');
  const src = local(clone, { type: 'worktree' });
  const tgt = local(clone, { type: 'branch', name: 'master' });
  const cmp = await compareSides(null, src, tgt, 'tips');
  const sides = await sidesContent(null, src, tgt, cmp.changes[0], cmp);
  expect(sides.right.content).toBe('wip\n');
});

test('local ↔ local : deux clones différents refusés', async () => {
  const a = makeOrigin().clone;
  const b = makeOrigin().clone;
  await compareSides(null, local(a, { type: 'branch', name: 'master' }), local(b, { type: 'branch', name: 'master' }), 'tips').then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).message).toMatch(/même clone/),
  );
});

test('Azure ↔ local (mixte) : comparaison par empreintes, contenu des deux côtés', async () => {
  const { clone } = makeOrigin();
  commitFile(clone, 'src/Service.cs', 'public class Service\n{\n    // Export v1\n    public int Amount => 20;\n}\n', 'align');
  const ctx = fakeContext();
  const src = local(clone, { type: 'branch', name: 'master' });
  const cmp = await compareSides(ctx, src, AZ_MASTER, 'tips');
  expect(cmp.kind).toBe('mixed');
  const paths = cmp.changes.map((c) => [c.path, c.change]);
  expect(paths).toContainEqual(['README.md', 'add']);
  expect(paths).toContainEqual(['old.sql', 'delete']);
  expect(paths.find(([p]) => p === 'src/Service.cs')).toBeUndefined(); // identique au fake master
  const readme = cmp.changes.find((c) => c.path === 'README.md')!;
  const sides = await sidesContent(ctx, src, AZ_MASTER, readme, cmp);
  expect(sides.left.content).toBe('');
  expect(sides.right.content).toBe('# Demo\n');
  const az = await compareSides(ctx, AZ_FEATURE, src, 'tips');
  expect(az.kind).toBe('mixed');
});

test('Azure ↔ Azure : inchangé', async () => {
  const cmp = await compareSides(fakeContext(), AZ_FEATURE, AZ_MASTER, 'mergeBase');
  expect(cmp.kind).toBe('azure');
  expect(cmp.baseCommit).toBe('base000');
});
