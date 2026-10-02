import { test, expect } from 'vitest';
import { fakeContext, FakeGitApi } from '../../src/main/azure/fake';
import { toRefName, shortBranch } from '../../src/main/azure/client';
import { listBranches, listProjects, listRepos } from '../../src/main/azure/browse';
import { listBranchChanges, getFileSide, listTree } from '../../src/main/azure/diff';
import { testConnection } from '../../src/main/auth';
import { normalizeError } from '../../src/main/errors';

test('toRefName / shortBranch handle slashes once', () => {
  expect(toRefName('feature/recharge-data')).toBe('refs/heads/feature/recharge-data');
  expect(toRefName('refs/heads/master')).toBe('refs/heads/master');
  expect(shortBranch('refs/heads/feature/x')).toBe('feature/x');
  expect(shortBranch('master')).toBe('master');
});

test('browse: projects, repos, branches with master first', async () => {
  const ctx = fakeContext();
  expect((await listProjects(ctx)).map((p) => p.name)).toEqual(['Demo']);
  expect(await listRepos(ctx, 'Demo')).toEqual([{ id: 'repo1', name: 'Gateway' }]);
  expect(await listBranches(ctx, 'Demo', 'repo1')).toEqual(['master', 'feature/data']);
});

test('testConnection succeeds on fake, fails as auth on 203 HTML sign-in', async () => {
  await expect(testConnection(fakeContext())).resolves.toBeUndefined();
  const ctx = fakeContext();
  ctx.core.getProjects = async () => '<html>sign in</html>' as never;
  await testConnection(ctx).then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).code).toBe('auth'),
  );
});

test('listBranchChanges paginates until allChangesIncluded', async () => {
  const ctx = fakeContext({ bulkChanges: 2500 });
  const r = await listBranchChanges(ctx, 'Demo', 'repo1', 'feature/data', 'master', 'mergeBase');
  expect(r.changes.length).toBe(2500);
  expect(r.baseCommit).toBe('base000');
  expect(r.sourceCommit).toBe('src111');
  expect(r.targetCommit).toBe('tgt222');
  expect((ctx.git as FakeGitApi).diffCalls).toBe(3);
});

test('tips mode uses target commit as base', async () => {
  const r = await listBranchChanges(fakeContext(), 'Demo', 'repo1', 'feature/data', 'master', 'tips');
  expect(r.baseCommit).toBe('tgt222');
  expect(r.changes.map((c) => c.path)).toContain('src/Service.cs');
});

test('getFileSide: text, 404 → empty side, binary, too large', async () => {
  const ctx = fakeContext();
  expect((await getFileSide(ctx, 'Demo', 'repo1', 'src/Service.cs', 'src111')).content).toContain('Export');
  expect(await getFileSide(ctx, 'Demo', 'repo1', 'missing.cs', 'base000')).toEqual({ content: '', isBinary: false, tooLarge: false, sizeBytes: 0 });
  expect((await getFileSide(ctx, 'Demo', 'repo1', 'logo.png', 'src111')).isBinary).toBe(true);
  const big = await getFileSide(ctx, 'Demo', 'repo1', 'big.sql', 'src111');
  expect(big.tooLarge).toBe(true);
  expect(big.content).toBe('');
});

test('getFileSide by branch name', async () => {
  const side = await getFileSide(fakeContext(), 'Demo', 'repo1', 'src/Service.cs', 'master', 'branch');
  expect(side.content).toContain('Export');
});

test('getFileSide: 401 / 203 stream → auth error', async () => {
  const ctx = fakeContext({ streamStatus: 401 });
  await getFileSide(ctx, 'Demo', 'repo1', 'src/Service.cs', 'src111').then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).code).toBe('auth'),
  );
  const ctx2 = fakeContext({ streamStatus: 203 });
  await getFileSide(ctx2, 'Demo', 'repo1', 'src/Service.cs', 'src111').then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).code).toBe('auth'),
  );
});

test('listTree: files only, no leading slash, no build dirs', async () => {
  const items = await listTree(fakeContext(), 'Demo', 'repo1', 'master');
  expect(items.map((i) => i.path).sort()).toEqual(['big.sql', 'old.sql', 'src/Service.cs']);
  expect(items[0].objectId).toMatch(/^[0-9a-f]{40}$/);
});
