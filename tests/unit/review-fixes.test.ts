import { test, expect } from 'vitest';
import { fakeContext, FakeGitApi } from '../../src/main/azure/fake';
import { guardNullResults } from '../../src/main/azure/client';
import { listBranchChanges, toFileSide, listTree } from '../../src/main/azure/diff';
import { createPr, completePr } from '../../src/main/azure/pr';
import { resolveConflict } from '../../src/main/azure/conflicts';
import { fromAzureDiff } from '../../src/main/compare/fromAzureDiff';
import { normalizeError } from '../../src/main/errors';
import { toResolution } from '../../src/renderer/src/lib/prLogic';

const NEW_PR = { source: 'feature/data', target: 'master', title: 't', description: '', workItemIds: [] as number[] };

test('I1: a JSON method resolving null (203 sign-in page) is an auth error', async () => {
  const api = guardNullResults({ getBranches: async () => null as unknown as string[], ok: async () => [1] });
  await expect(api.ok()).resolves.toEqual([1]);
  await api.getBranches().then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).code).toBe('auth'),
  );
});

test('I2: pagination advances by the number of changes actually returned', async () => {
  const ctx = fakeContext({ bulkChanges: 250, pageCap: 100 });
  const r = await listBranchChanges(ctx, 'Demo', 'repo1', 'feature/data', 'master', 'mergeBase');
  expect(r.changes).toHaveLength(250);
});

test('I3: conflict update sends the full conflict with the new resolution', async () => {
  const ctx = fakeContext();
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  await resolveConflict(ctx, 'Demo', 'repo1', pr.id, 1, { kind: 'target' });
  expect((ctx.git as unknown as FakeGitApi).lastResolution).toMatchObject({
    conflictId: 1,
    conflictType: 8,
    conflictPath: '/src/Service.cs',
    mergeSourceCommit: { commitId: 'src111' },
    resolutionStatus: 2,
    resolution: { mergeType: 2 },
  });
});

test('I4: non-UTF-8 content is flagged lossy; UTF-8 BOM is stripped and remembered', () => {
  const cp1252 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]); // "café\n" en cp1252
  expect(toFileSide(cp1252)).toMatchObject({ lossy: true });
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('class A {}\n')]);
  expect(toFileSide(bom)).toMatchObject({ content: 'class A {}\n', bom: true, lossy: false });
  expect(toFileSide(Buffer.from('é\n'))).toMatchObject({ content: 'é\n', bom: false, lossy: false });
});

test('I4: edited resolution keeps the BOM of the original files', () => {
  expect(toResolution('mix', 's', 't', true)).toEqual({ kind: 'content', text: '﻿mix' });
  expect(toResolution('s', 's', 't', true)).toEqual({ kind: 'source' });
});

test('I5: completePr waits until Azure has really completed the PR', async () => {
  const ctx = fakeContext({ noConflicts: true, completionPolls: 2 });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  const done = await completePr(ctx, 'Demo', 'repo1', 'Gateway', pr.id, { mergeStrategy: 'squash', deleteSourceBranch: false, transitionWorkItems: false, commitMessage: 'm' }, { intervalMs: 1 });
  expect(done.status).toBe('completed');
});

test('I5: completePr reports an asynchronous merge failure', async () => {
  const ctx = fakeContext({ noConflicts: true, completionFails: 'Merge failed: policy' });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  const done = await completePr(ctx, 'Demo', 'repo1', 'Gateway', pr.id, { mergeStrategy: 'squash', deleteSourceBranch: false, transitionWorkItems: false, commitMessage: 'm' }, { intervalMs: 1 });
  expect(done.status).toBe('active');
  expect(done.failureMessage).toBe('Merge failed: policy');
});

test('I6: 403 is a permission error, not a session-ending auth error', () => {
  expect(normalizeError({ statusCode: 403, message: 'x' }).code).toBe('forbidden');
  expect(normalizeError({ statusCode: 401, message: 'x' }).code).toBe('auth');
});

test('M1→I: folders given with string gitObjectType are skipped', async () => {
  expect(fromAzureDiff([{ changeType: 1, item: { path: '/src', gitObjectType: 'tree' as unknown as number } }, { changeType: 2, item: { path: '/a.cs', gitObjectType: 'blob' as unknown as number } }]).map((c) => c.path)).toEqual(['a.cs']);
  const items = await listTree(fakeContext({ stringObjectTypes: true }), 'Demo', 'repo1', 'master');
  expect(items.map((i) => i.path).sort()).toEqual(['big.sql', 'old.sql', 'src/Service.cs']);
});
