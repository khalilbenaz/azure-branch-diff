import type { ApiError, ChangeEntry, FileSide, Side } from '../../shared/types';
import type { CompareResult } from '../../shared/api';
import type { AzureContext } from '../azure/client';
import { EMPTY_SIDE, getFileSide, listBranchChanges, listTree } from '../azure/diff';
import { getGitInfo } from '../local/gitInfo';
import { listLocalChanges, localFileSide, WORKTREE } from '../local/localDiff';
import { localTree, resolveCommit } from '../local/repo';
import { insideGitRepo } from '../local/safeGit';
import { compareTrees } from './compareLocal';

const fail = (message: string): ApiError => ({ code: 'unknown', message });

function needCtx(ctx: AzureContext | null): AzureContext {
  if (!ctx) throw { code: 'auth', message: 'Connectez-vous à Azure DevOps pour utiliser une branche Azure.' } satisfies ApiError;
  return ctx;
}

/** Commit (ou WORKTREE) d'un côté local, figé au moment de la comparaison. */
async function localCommit(side: Extract<Side, { kind: 'local' }>): Promise<string> {
  return side.ref.type === 'worktree' ? WORKTREE : resolveCommit(side.root, side.ref);
}

/** Comparaison de `source` (droite) par rapport à `target` (gauche), quelles que soient leurs natures. */
export async function compareSides(ctx: AzureContext | null, source: Side, target: Side, mode: 'mergeBase' | 'tips'): Promise<CompareResult> {
  if (source.kind === 'azure' && target.kind === 'azure') {
    if (source.repoId !== target.repoId) throw fail('Les deux branches doivent appartenir au même dépôt.');
    const r = await listBranchChanges(needCtx(ctx), target.project, target.repoId, source.branch, target.branch, mode);
    return { kind: 'azure', ...r };
  }
  if (source.kind === 'local' && target.kind === 'local' && source.root === target.root && (await insideGitRepo(source.root))) {
    const r = await listLocalChanges(source.root, target.ref, source.ref, mode);
    const local = source.ref.type === 'worktree' ? await getGitInfo(source.root) : undefined;
    return { kind: 'local', changes: r.changes, baseCommit: r.baseCommit, sourceCommit: r.headCommit, targetCommit: r.baseCommit, local };
  }
  // Mixte (Azure ↔ local, ou deux dossiers différents) : pas d'historique commun ; comparaison des têtes par empreintes.
  const tree = (side: Side) => (side.kind === 'azure' ? listTree(needCtx(ctx), side.project, side.repoId, side.branch) : localTree(side.root, side.ref));
  const [left, right] = await Promise.all([tree(target), tree(source)]);
  const [targetCommit, sourceCommit] = await Promise.all([
    target.kind === 'local' ? localCommit(target) : Promise.resolve(target.branch),
    source.kind === 'local' ? localCommit(source) : Promise.resolve(source.branch),
  ]);
  return { kind: 'mixed', changes: compareTrees(left, right), targetCommit, sourceCommit };
}

async function sideContent(ctx: AzureContext | null, side: Side, path: string, commit: string | undefined, cmp: CompareResult): Promise<FileSide> {
  if (side.kind === 'local') return localFileSide(side.root, commit ?? WORKTREE, path);
  const c = needCtx(ctx);
  // Mixte : la branche Azure est lue à sa tête ; Azure ↔ Azure : au commit figé.
  return cmp.kind === 'mixed' ? getFileSide(c, side.project, side.repoId, path, side.branch, 'branch') : getFileSide(c, side.project, side.repoId, path, commit ?? '');
}

/** Contenus gauche (cible) et droite (source) d'un fichier de la comparaison. */
export async function sidesContent(
  ctx: AzureContext | null,
  source: Side,
  target: Side,
  entry: ChangeEntry,
  cmp: CompareResult,
): Promise<{ left: FileSide; right: FileSide }> {
  const leftPath = entry.originalPath ?? entry.path;
  const leftCommit = cmp.kind === 'mixed' ? cmp.targetCommit : cmp.baseCommit;
  const [left, right] = await Promise.all([
    entry.change === 'add' ? EMPTY_SIDE : sideContent(ctx, target, leftPath, leftCommit, cmp),
    entry.change === 'delete' ? EMPTY_SIDE : sideContent(ctx, source, entry.path, cmp.sourceCommit, cmp),
  ]);
  return { left, right };
}
