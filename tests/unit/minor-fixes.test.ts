import { test, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeContext, FakeGitApi } from '../../src/main/azure/fake';
import { createPr, waitMergeStatus } from '../../src/main/azure/pr';
import { getConflictSides, listConflicts, resolveConflict } from '../../src/main/azure/conflicts';
import { listProjects } from '../../src/main/azure/browse';
import { getFileSide } from '../../src/main/azure/diff';
import { hashLocalFiles } from '../../src/main/local/hashFiles';
import { listLocalFiles } from '../../src/main/local/listFiles';
import { compareLocalToAzure } from '../../src/main/compare/compareLocal';
import { createHandlers } from '../../src/main/ipc';
import { AuthStore } from '../../src/main/auth';
import { tempDir, reverseCipher, gitDir, worktreeSide } from './helpers';

const NEW_PR = { source: 'feature/data', target: 'master', title: 't', description: '', workItemIds: [] as number[] };

test('m1: conflict without merge base gives an empty base side without calling Azure', async () => {
  const ctx = fakeContext({ conflictWithoutBase: true });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  const sides = await getConflictSides(ctx, 'Demo', 'repo1', pr.id, 1);
  expect(sides.base).toEqual({ content: '', isBinary: false, tooLarge: false, sizeBytes: 0 });
  expect((ctx.git as unknown as FakeGitApi).contentVersions).not.toContain('');
});

test('m2: after resolving, waitMergeStatus can keep polling while status still says conflicts', async () => {
  const ctx = fakeContext({ staleConflictPolls: 2 });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  for (const c of await listConflicts(ctx, 'Demo', 'repo1', pr.id)) await resolveConflict(ctx, 'Demo', 'repo1', pr.id, c.id, { kind: 'source' });
  const r = await waitMergeStatus(ctx, 'Demo', 'repo1', 'Gateway', pr.id, { intervalMs: 1, alsoWhileConflicts: true });
  expect(r.mergeStatus).toBe('succeeded');
});

test('m7: submodule (gitlink) and unreadable entries do not break hashing or comparison', async () => {
  const root = tempDir({ 'a.cs': 'x' });
  execSync('git init -q && git add a.cs && git update-index --add --cacheinfo 160000,1111111111111111111111111111111111111111,sub', { cwd: root });
  mkdirSync(join(root, 'sub'));
  const files = await listLocalFiles(root);
  expect(files).toEqual(['a.cs']);
  const m = await hashLocalFiles(root, ['a.cs', 'sub']);
  expect([...m.keys()]).toEqual(['a.cs']);
  await expect(compareLocalToAzure(root, [])).resolves.toHaveLength(1);
});

test('m7: hashing many files with long paths works (stdin, no command-line limit)', async () => {
  const files: Record<string, string> = {};
  const long = 'd'.repeat(40); // chemins < 260 caractères : sans core.longpaths, Git pour Windows les refuserait
  for (let i = 0; i < 250; i++) files[`${long}/${long}/f${i}.cs`] = `x${i}`;
  const root = tempDir(files);
  execSync('git init -q', { cwd: root });
  const m = await hashLocalFiles(root, Object.keys(files));
  expect(m.size).toBe(250);
});

test('m8: a file named "..foo" is readable; a symlink escaping the folder is refused', async () => {
  const outside = tempDir({ 'secret.txt': 'secret' });
  const root = gitDir({ '..foo': 'ok\n' });
  // Sous Windows, créer un lien symbolique demande des droits administrateur : on teste alors le reste.
  const canLink = process.platform !== 'win32';
  if (canLink) symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
  const api = createHandlers({ store: new AuthStore(join(tempDir(), 'c.json'), reverseCipher), connect: async () => fakeContext(), pickFolder: async () => root, openExternal: async () => {} });
  await api.login('https://dev.azure.com/X', 'pat');
  await api.pickFolder();
  const target = { kind: 'azure' as const, project: 'Demo', repoId: 'repo1', branch: 'master' };
  const ok = await api.fileSides(worktreeSide(root), target, { path: '..foo', change: 'add', isBinary: false }, { changes: [] });
  expect(ok.ok && ok.value.right.content).toBe('ok\n');
  if (canLink) {
    const bad = await api.fileSides(worktreeSide(root), target, { path: 'link.txt', change: 'add', isBinary: false }, { changes: [] });
    expect(bad.ok).toBe(false);
  }
});

test('m9: projects are paginated beyond 100', async () => {
  const ctx = fakeContext({ manyProjects: 250 });
  expect(await listProjects(ctx)).toHaveLength(250);
});

test('m9: conflicts are paginated beyond 100', async () => {
  const ctx = fakeContext({ manyConflicts: 230 });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  expect(await listConflicts(ctx, 'Demo', 'repo1', pr.id)).toHaveLength(230);
});

test('m9: file content is requested with LFS resolution', async () => {
  const ctx = fakeContext();
  await getFileSide(ctx, 'Demo', 'repo1', 'src/Service.cs', 'src111');
  expect((ctx.git as unknown as FakeGitApi).lastResolveLfs).toBe(true);
});

test('m10: a failed credential save does not leave the session open', async () => {
  const api = createHandlers({
    store: new AuthStore(join(tempDir(), 'c.json'), { ...reverseCipher, isAvailable: () => false }),
    connect: async () => fakeContext(),
    pickFolder: async () => null,
    openExternal: async () => {},
  });
  expect((await api.login('https://dev.azure.com/X', 'pat')).ok).toBe(false);
  const r = await api.projects();
  expect(!r.ok && r.error.code).toBe('auth');
});
