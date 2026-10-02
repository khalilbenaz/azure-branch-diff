import { test, expect } from 'vitest';
import { GitResolutionMergeType, GitResolutionStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { fakeContext, FakeGitApi } from '../../src/main/azure/fake';
import { prWebUrl, prConflictsUrl, fileWebUrl, findActivePr, createPr, waitMergeStatus, completePr, getPr } from '../../src/main/azure/pr';
import { listConflicts, buildResolution, resolveConflict, getConflictSides, conflictTypeName } from '../../src/main/azure/conflicts';
import { normalizeError } from '../../src/main/errors';

const NEW_PR = { source: 'feature/data', target: 'master', title: 't', description: '', workItemIds: [] as number[] };
const fakeOf = (ctx: ReturnType<typeof fakeContext>) => ctx.git as unknown as FakeGitApi;

test('web urls encode project, repo and path', () => {
  expect(prWebUrl('https://dev.azure.com/O', 'Mon Projet', 'Gateway', 5)).toBe('https://dev.azure.com/O/Mon%20Projet/_git/Gateway/pullrequest/5');
  expect(prConflictsUrl('https://dev.azure.com/O', 'P', 'R', 5)).toBe('https://dev.azure.com/O/P/_git/R/pullrequest/5?_a=conflicts');
  expect(fileWebUrl('https://dev.azure.com/O', 'P', 'R', 'src/A b.cs', 'feature/x')).toBe(
    'https://dev.azure.com/O/P/_git/R?path=%2Fsrc%2FA%20b.cs&version=GBfeature%2Fx',
  );
});

test('create PR sends refs and work items, then find returns it', async () => {
  const ctx = fakeContext();
  expect(await findActivePr(ctx, 'Demo', 'repo1', 'Gateway', 'feature/data', 'master')).toBeNull();
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', { ...NEW_PR, workItemIds: [42] });
  expect(pr).toMatchObject({ id: 1, title: 't', sourceBranch: 'feature/data', targetBranch: 'master' });
  expect(pr.url).toBe('https://dev.azure.com/Fake/Demo/_git/Gateway/pullrequest/1');
  expect(fakeOf(ctx).lastCreated).toMatchObject({ sourceRefName: 'refs/heads/feature/data', targetRefName: 'refs/heads/master', workItemRefs: [{ id: '42' }] });
  expect((await findActivePr(ctx, 'Demo', 'repo1', 'Gateway', 'feature/data', 'master'))?.id).toBe(1);
});

test('waitMergeStatus polls until computed', async () => {
  const ctx = fakeContext({ queuedPolls: 2 });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  expect((await waitMergeStatus(ctx, 'Demo', 'repo1', 'Gateway', pr.id, { intervalMs: 1 })).mergeStatus).toBe('conflicts');
});

test('waitMergeStatus gives up after timeout and returns queued', async () => {
  const ctx = fakeContext({ queuedPolls: 100000 });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  expect((await waitMergeStatus(ctx, 'Demo', 'repo1', 'Gateway', pr.id, { intervalMs: 1, timeoutMs: 20 })).mergeStatus).toBe('queued');
});

test('mergeStatus given as string by the API is understood', async () => {
  const ctx = fakeContext({ stringEnums: true });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  expect((await getPr(ctx, 'Demo', 'repo1', 'Gateway', pr.id)).mergeStatus).toBe('conflicts');
  expect((await listConflicts(ctx, 'Demo', 'repo1', pr.id))[0]).toMatchObject({ type: 'editEdit', resolvableInApp: true });
});

test('conflictTypeName', () => {
  expect(conflictTypeName(8)).toBe('editEdit');
  expect(conflictTypeName('renameDelete')).toBe('renameDelete');
  expect(conflictTypeName(99)).toBe('unknown');
});

test('conflicts list, sides and resolution', async () => {
  const ctx = fakeContext();
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  expect(await listConflicts(ctx, 'Demo', 'repo1', pr.id)).toEqual([
    { id: 1, path: 'src/Service.cs', type: 'editEdit', resolvableInApp: true, resolved: false },
    { id: 2, path: 'img/logo.png', type: 'renameDelete', resolvableInApp: false, resolved: false },
  ]);
  const sides = await getConflictSides(ctx, 'Demo', 'repo1', pr.id, 1);
  expect(sides.source.content).toContain('Export csv');
  expect(sides.target.content).toContain('Amount => 20');
  expect(sides.base.content).toContain('Amount => 10');

  await resolveConflict(ctx, 'Demo', 'repo1', pr.id, 1, { kind: 'content', text: 'é' });
  expect(fakeOf(ctx).lastResolution).toMatchObject({
    conflictId: 1,
    resolution: { mergeType: GitResolutionMergeType.UserMerged, userMergedContent: [0xc3, 0xa9] },
    resolutionStatus: GitResolutionStatus.Resolved,
  });
  expect((await listConflicts(ctx, 'Demo', 'repo1', pr.id))[0].resolved).toBe(true);
});

test('buildResolution source/target', () => {
  expect(buildResolution({ kind: 'source' })).toEqual({ mergeType: GitResolutionMergeType.TakeSourceContent });
  expect(buildResolution({ kind: 'target' })).toEqual({ mergeType: GitResolutionMergeType.TakeTargetContent });
});

test('resolving a conflict that no longer exists is refused as stale', async () => {
  const ctx = fakeContext();
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  await resolveConflict(ctx, 'Demo', 'repo1', pr.id, 99, { kind: 'target' }).then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).code).toBe('stale'),
  );
  expect(fakeOf(ctx).lastResolution).toBeUndefined();
});

test('completePr sends status, last source commit and options', async () => {
  const ctx = fakeContext({ noConflicts: true });
  const pr = await createPr(ctx, 'Demo', 'repo1', 'Gateway', NEW_PR);
  await completePr(ctx, 'Demo', 'repo1', 'Gateway', pr.id, { mergeStrategy: 'squash', deleteSourceBranch: true, transitionWorkItems: true, commitMessage: 'm' });
  expect(fakeOf(ctx).lastUpdate).toMatchObject({
    status: 3,
    lastMergeSourceCommit: { commitId: 'src111' },
    completionOptions: { mergeStrategy: 2, deleteSourceBranch: true, transitionWorkItems: true, mergeCommitMessage: 'm' },
  });
});
