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

test('local ↔ local : deux clones différents comparés par empreintes (dernières versions)', async () => {
  const a = makeOrigin().clone;
  const b = makeOrigin().clone;
  commitFile(b, 'only-b.txt', 'b\n');
  const cmp = await compareSides(null, local(b, { type: 'branch', name: 'master' }), local(a, { type: 'branch', name: 'master' }), 'mergeBase');
  expect(cmp.kind).toBe('mixed');
  expect(cmp.changes.map((c) => [c.path, c.change])).toEqual([['only-b.txt', 'add']]);
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

test('mode PR : un fichier déjà porté à l’identique sur la cible est marqué inTarget (local)', async () => {
  const { clone } = makeOrigin();
  git(clone, 'checkout', '-q', 'master');
  // Portage sur master (commit à part, sans merge) du Data.cs de feature/data.
  commitFile(clone, 'src/Data.cs', git(clone, 'show', 'origin/feature/data:src/Data.cs') + '\n');
  const cmp = await compareSides(null, local(clone, { type: 'remote', name: 'feature/data' }), local(clone, { type: 'branch', name: 'master' }), 'mergeBase');
  const flags = Object.fromEntries(cmp.changes.map((c) => [c.path, !!c.inTarget]));
  expect(flags).toEqual({ 'src/Data.cs': true, 'src/Service.cs': false });
  const tips = await compareSides(null, local(clone, { type: 'remote', name: 'feature/data' }), local(clone, { type: 'branch', name: 'master' }), 'tips');
  expect(tips.changes.some((c) => c.inTarget)).toBe(false);
});

test('mode PR : un fichier déjà identique sur la cible est marqué inTarget (Azure)', async () => {
  const change = (path: string, changeType = 2) => ({ changeType, item: { path, gitObjectType: 3 } });
  const ctx = {
    orgUrl: 'https://dev.azure.com/demo',
    core: { getProjects: async () => [] },
    git: {
      getCommitDiffs: async (_r: string, _p: string, common: boolean) =>
        common
          ? { changes: [change('/ported.cs', 1), change('/new.cs', 1), change('/both.cs')], allChangesIncluded: true, commonCommit: 'b', baseCommit: 't', targetCommit: 's' }
          : { changes: [change('/new.cs', 1), change('/both.cs')], allChangesIncluded: true, baseCommit: 't', targetCommit: 's' },
    },
  } as unknown as Parameters<typeof compareSides>[0];
  const cmp = await compareSides(ctx, AZ_FEATURE, AZ_MASTER, 'mergeBase');
  expect(Object.fromEntries(cmp.changes.map((c) => [c.path, !!c.inTarget]))).toEqual({ 'both.cs': false, 'new.cs': false, 'ported.cs': true });
});

test('mode PR : la gauche montre l’état actuel de la cible, pas l’ancêtre commun', async () => {
  const { clone } = makeOrigin();
  git(clone, 'checkout', '-q', 'master');
  const svc = git(clone, 'show', 'origin/feature/data:src/Service.cs');
  commitFile(clone, 'src/Service.cs', svc.replace('Amount = 30', 'Amount = 20') + '\n');
  commitFile(clone, 'src/Data.cs', 'version master\n'); // ajouté par la source, existe déjà (différent) sur la cible
  const src = local(clone, { type: 'remote', name: 'feature/data' });
  const tgt = local(clone, { type: 'branch', name: 'master' });
  const cmp = await compareSides(null, src, tgt, 'mergeBase');
  expect(cmp.targetCommit).toBe(git(clone, 'rev-parse', 'master'));
  const left = async (p: string) => (await sidesContent(null, src, tgt, cmp.changes.find((c) => c.path === p)!, cmp)).left.content;
  expect(await left('src/Service.cs')).toContain('Amount = 20');
  expect(await left('src/Data.cs')).toBe('version master\n');
});
