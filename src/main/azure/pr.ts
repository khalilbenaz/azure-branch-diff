import { PullRequestAsyncStatus, PullRequestStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { GitPullRequest } from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { CompleteOptions, MergeStatus, PrStatus, PrSummary } from '../../shared/types';
import { type AzureContext, shortBranch, toRefName } from './client';

const enc = encodeURIComponent;

export const repoWebUrl = (orgUrl: string, project: string, repoName: string) => `${orgUrl}/${enc(project)}/_git/${enc(repoName)}`;
export const prWebUrl = (orgUrl: string, project: string, repoName: string, prId: number) =>
  `${repoWebUrl(orgUrl, project, repoName)}/pullrequest/${prId}`;
export const prConflictsUrl = (orgUrl: string, project: string, repoName: string, prId: number) =>
  `${prWebUrl(orgUrl, project, repoName, prId)}?_a=conflicts`;
export const fileWebUrl = (orgUrl: string, project: string, repoName: string, path: string, branch: string) =>
  `${repoWebUrl(orgUrl, project, repoName)}?path=${enc('/' + path)}&version=GB${enc(branch)}`;

const MERGE_STATUS: Record<number, MergeStatus> = {
  [PullRequestAsyncStatus.NotSet]: 'notSet',
  [PullRequestAsyncStatus.Queued]: 'queued',
  [PullRequestAsyncStatus.Conflicts]: 'conflicts',
  [PullRequestAsyncStatus.Succeeded]: 'succeeded',
  [PullRequestAsyncStatus.RejectedByPolicy]: 'rejectedByPolicy',
  [PullRequestAsyncStatus.Failure]: 'failure',
};

/** L'API renvoie l'enum en nombre (SDK) ou en chaîne camelCase selon les versions : on accepte les deux. */
export function mergeStatusOf(v: unknown): MergeStatus {
  if (typeof v === 'number') return MERGE_STATUS[v] ?? 'notSet';
  if (typeof v === 'string') {
    const s = (v.charAt(0).toLowerCase() + v.slice(1)) as MergeStatus;
    return Object.values(MERGE_STATUS).includes(s) ? s : 'notSet';
  }
  return 'notSet';
}

const PR_STATUS: Record<number, PrStatus> = {
  [PullRequestStatus.NotSet]: 'notSet',
  [PullRequestStatus.Active]: 'active',
  [PullRequestStatus.Abandoned]: 'abandoned',
  [PullRequestStatus.Completed]: 'completed',
};

export function prStatusOf(v: unknown): PrStatus {
  if (typeof v === 'number') return PR_STATUS[v] ?? 'notSet';
  if (typeof v === 'string' && Object.values(PR_STATUS).includes(v.toLowerCase() as PrStatus)) return v.toLowerCase() as PrStatus;
  return 'notSet';
}

const STRATEGY: Record<CompleteOptions['mergeStrategy'], number> = { noFastForward: 1, squash: 2, rebase: 3, rebaseMerge: 4 };

export function toSummary(orgUrl: string, project: string, repoName: string, pr: GitPullRequest): PrSummary {
  return {
    id: pr.pullRequestId ?? 0,
    title: pr.title ?? '',
    url: prWebUrl(orgUrl, project, repoName, pr.pullRequestId ?? 0),
    sourceBranch: shortBranch(pr.sourceRefName ?? ''),
    targetBranch: shortBranch(pr.targetRefName ?? ''),
    mergeStatus: mergeStatusOf(pr.mergeStatus),
    status: prStatusOf(pr.status),
    ...(pr.lastMergeSourceCommit?.commitId ? { lastMergeSourceCommit: pr.lastMergeSourceCommit.commitId } : {}),
    ...(pr.mergeFailureMessage ? { failureMessage: pr.mergeFailureMessage } : {}),
  };
}

export async function findActivePr(ctx: AzureContext, project: string, repoId: string, repoName: string, source: string, target: string) {
  const prs = await ctx.git.getPullRequests(
    repoId,
    { sourceRefName: toRefName(source), targetRefName: toRefName(target), status: PullRequestStatus.Active },
    project,
  );
  return prs.length ? toSummary(ctx.orgUrl, project, repoName, prs[0]) : null;
}

export interface NewPr {
  source: string;
  target: string;
  title: string;
  description: string;
  workItemIds: number[];
}

export async function createPr(ctx: AzureContext, project: string, repoId: string, repoName: string, i: NewPr): Promise<PrSummary> {
  const pr = await ctx.git.createPullRequest(
    {
      sourceRefName: toRefName(i.source),
      targetRefName: toRefName(i.target),
      title: i.title,
      description: i.description,
      workItemRefs: i.workItemIds.map((id) => ({ id: String(id) })),
    },
    repoId,
    project,
  );
  return toSummary(ctx.orgUrl, project, repoName, pr);
}

export async function getPr(ctx: AzureContext, project: string, repoId: string, repoName: string, prId: number): Promise<PrSummary> {
  return toSummary(ctx.orgUrl, project, repoName, await ctx.git.getPullRequestById(prId, project));
}

/** Attend qu'Azure ait calculé le merge (toutes les 2 s, 30 s max). Renvoie le dernier état connu. */
export async function waitMergeStatus(
  ctx: AzureContext,
  project: string,
  repoId: string,
  repoName: string,
  prId: number,
  { intervalMs = 2000, timeoutMs = 30000, alsoWhileConflicts = false } = {},
): Promise<PrSummary> {
  const end = Date.now() + timeoutMs;
  // Après la dernière résolution, Azure peut encore afficher « conflicts » le temps de recalculer le merge.
  const pending = (s: PrSummary['mergeStatus']) => s === 'queued' || s === 'notSet' || (alsoWhileConflicts && s === 'conflicts');
  let pr = await getPr(ctx, project, repoId, repoName, prId);
  while (pending(pr.mergeStatus) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, intervalMs));
    pr = await getPr(ctx, project, repoId, repoName, prId);
  }
  return pr;
}

export async function completePr(
  ctx: AzureContext,
  project: string,
  repoId: string,
  repoName: string,
  prId: number,
  o: CompleteOptions,
  { intervalMs = 2000, timeoutMs = 30000 } = {},
): Promise<PrSummary> {
  const current = await ctx.git.getPullRequestById(prId, project);
  await ctx.git.updatePullRequest(
    {
      status: PullRequestStatus.Completed,
      lastMergeSourceCommit: current.lastMergeSourceCommit,
      completionOptions: {
        mergeStrategy: STRATEGY[o.mergeStrategy],
        deleteSourceBranch: o.deleteSourceBranch,
        transitionWorkItems: o.transitionWorkItems,
        mergeCommitMessage: o.commitMessage,
      },
    },
    repoId,
    prId,
    project,
  );
  // La complétion est asynchrone côté Azure : on attend « completed » ou un message d'échec.
  const end = Date.now() + timeoutMs;
  let pr = await getPr(ctx, project, repoId, repoName, prId);
  while (pr.status === 'active' && !pr.failureMessage && Date.now() < end) {
    await new Promise((r) => setTimeout(r, intervalMs));
    pr = await getPr(ctx, project, repoId, repoName, prId);
  }
  return pr;
}
