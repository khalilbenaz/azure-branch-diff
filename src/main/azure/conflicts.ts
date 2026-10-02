import { GitConflictType, GitResolutionMergeType, GitResolutionStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { GitConflict, GitResolutionMergeContent } from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { ApiError, ConflictEntry, FileSide, Resolution } from '../../shared/types';
import type { AzureContext } from './client';
import { EMPTY_SIDE, getFileSide } from './diff';

const PAGE = 100;

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Nom camelCase du type de conflit, que l'API l'ait renvoyé en nombre ou en chaîne. */
export function conflictTypeName(v: unknown): string {
  if (typeof v === 'string') return lowerFirst(v);
  if (typeof v === 'number' && v !== GitConflictType.None && GitConflictType[v]) return lowerFirst(GitConflictType[v]);
  return 'unknown';
}

const isResolved = (v: unknown) => v === GitResolutionStatus.Resolved || v === 'resolved';

function toEntry(c: GitConflict): ConflictEntry {
  const type = conflictTypeName(c.conflictType);
  return {
    id: c.conflictId ?? 0,
    path: (c.conflictPath ?? '').replace(/^\/+/, ''),
    type,
    resolvableInApp: type === 'editEdit',
    resolved: isResolved(c.resolutionStatus),
  };
}

async function rawConflicts(ctx: AzureContext, project: string, repoId: string, prId: number): Promise<GitConflict[]> {
  const all: GitConflict[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await ctx.git.getPullRequestConflicts(repoId, prId, project, skip, PAGE, false);
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

export async function listConflicts(ctx: AzureContext, project: string, repoId: string, prId: number): Promise<ConflictEntry[]> {
  return (await rawConflicts(ctx, project, repoId, prId)).map(toEntry);
}

async function findConflict(ctx: AzureContext, project: string, repoId: string, prId: number, conflictId: number) {
  const c = (await rawConflicts(ctx, project, repoId, prId)).find((x) => x.conflictId === conflictId);
  if (!c) {
    const stale: ApiError = { code: 'stale', message: 'La branche cible a changé : ce conflit n’existe plus. La liste a été rechargée.' };
    throw stale;
  }
  return c;
}

/** Contenus source, cible et ancêtre commun d'un conflit. */
export async function getConflictSides(
  ctx: AzureContext,
  project: string,
  repoId: string,
  prId: number,
  conflictId: number,
): Promise<{ source: FileSide; target: FileSide; base: FileSide }> {
  const c = await findConflict(ctx, project, repoId, prId, conflictId);
  const path = (c.conflictPath ?? '').replace(/^\/+/, '');
  const side = (commit?: string) => (commit ? getFileSide(ctx, project, repoId, path, commit) : Promise.resolve(EMPTY_SIDE));
  const [source, target, base] = await Promise.all([
    side(c.mergeSourceCommit?.commitId),
    side(c.mergeTargetCommit?.commitId),
    side(c.mergeBaseCommit?.commitId),
  ]);
  return { source, target, base };
}

export function buildResolution(r: Resolution): GitResolutionMergeContent {
  if (r.kind === 'source') return { mergeType: GitResolutionMergeType.TakeSourceContent };
  if (r.kind === 'target') return { mergeType: GitResolutionMergeType.TakeTargetContent };
  return { mergeType: GitResolutionMergeType.UserMerged, userMergedContent: [...Buffer.from(r.text, 'utf8')] };
}

/** Envoie la résolution d'un conflit. Relit d'abord la liste : un conflit disparu (cible modifiée) n'est pas envoyé. */
export async function resolveConflict(
  ctx: AzureContext,
  project: string,
  repoId: string,
  prId: number,
  conflictId: number,
  r: Resolution,
): Promise<void> {
  const current = await findConflict(ctx, project, repoId, prId, conflictId);
  // On renvoie le conflit complet (type, chemin, commits) : le serveur choisit le type de résolution selon conflictType.
  const update = { ...current, resolution: buildResolution(r), resolutionStatus: GitResolutionStatus.Resolved } as GitConflict;
  await ctx.git.updatePullRequestConflict(update, repoId, prId, conflictId, project);
}
