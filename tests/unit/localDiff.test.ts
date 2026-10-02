import { test, expect } from 'vitest';
import { listLocalChanges, localFileSide } from '../../src/main/local/localDiff';
import { makeOrigin, git, commitFile, writeFile } from './gitFixtures';

const M = { type: 'branch' as const, name: 'master' };
const F = { type: 'remote' as const, name: 'feature/data' };

test('comme une PR : seulement les changements de la source depuis l’ancêtre commun', async () => {
  const { clone } = makeOrigin();
  commitFile(clone, 'README.md', '# Demo master change\n', 'master moves on');
  const pr = await listLocalChanges(clone, M, F, 'mergeBase');
  expect(pr.changes.map((c) => [c.path, c.change])).toEqual([
    ['src/Data.cs', 'add'],
    ['src/Service.cs', 'edit'],
  ]);
  const tips = await listLocalChanges(clone, M, F, 'tips');
  expect(tips.changes.map((c) => c.path)).toContain('README.md');
  expect(pr.headCommit).toBe(git(clone, 'rev-parse', 'origin/feature/data'));
});

test('renommage détecté', async () => {
  const { clone } = makeOrigin();
  git(clone, 'checkout', '-q', '-b', 'ren');
  git(clone, 'mv', 'src/Service.cs', 'src/Svc.cs');
  git(clone, 'commit', '-q', '-m', 'rename');
  const r = await listLocalChanges(clone, M, { type: 'branch', name: 'ren' }, 'tips');
  expect(r.changes).toEqual([{ path: 'src/Svc.cs', originalPath: 'src/Service.cs', change: 'rename', isBinary: false }]);
});

test('copie de travail : modifications et fichiers non suivis, sans .gitignore', async () => {
  const { clone } = makeOrigin();
  writeFile(clone, '.gitignore', '*.log\n');
  writeFile(clone, 'src/Service.cs', 'local edit\n');
  writeFile(clone, 'new file.cs', 'n\n');
  writeFile(clone, 'debug.log', 'x\n');
  const r = await listLocalChanges(clone, M, { type: 'worktree' }, 'tips');
  expect(r.headCommit).toBe('WORKTREE');
  expect(r.changes.map((c) => [c.path, c.change])).toEqual([
    ['.gitignore', 'add'],
    ['new file.cs', 'add'],
    ['src/Service.cs', 'edit'],
  ]);
});

test('contenu : git show, copie de travail, binaire, absent', async () => {
  const { clone } = makeOrigin();
  const head = git(clone, 'rev-parse', 'origin/feature/data');
  expect((await localFileSide(clone, head, 'src/Service.cs')).content).toContain('Amount = 30');
  writeFile(clone, 'src/Service.cs', 'disk\n');
  expect((await localFileSide(clone, 'WORKTREE', 'src/Service.cs')).content).toBe('disk\n');
  commitFile(clone, 'bin.dat', Buffer.from([1, 0, 2]), 'bin');
  expect((await localFileSide(clone, git(clone, 'rev-parse', 'HEAD'), 'bin.dat')).isBinary).toBe(true);
  expect((await localFileSide(clone, head, 'nope.cs')).content).toBe('');
});

test('branche au nom accentué et chemin avec espaces', async () => {
  const { clone } = makeOrigin();
  git(clone, 'checkout', '-q', '-b', 'feature/é-x');
  commitFile(clone, 'dir a/f b.cs', 'x\n');
  const r = await listLocalChanges(clone, M, { type: 'branch', name: 'feature/é-x' }, 'mergeBase');
  expect(r.changes.map((c) => c.path)).toEqual(['dir a/f b.cs']);
});
