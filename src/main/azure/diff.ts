import { GitVersionType, VersionControlRecursionType } from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { GitCommitDiffs } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { MAX_DIFF_BYTES, type ChangeEntry, type FileSide } from '../../shared/types';
import { fromAzureDiff, type AzureChange } from '../compare/fromAzureDiff';
import { isBinaryBuffer, type RemoteItem } from '../compare/compareLocal';
import { inExcludedDir } from '../local/listFiles';
import { type AzureContext, readStream } from './client';

const PAGE = 1000;
const GIT_BLOB = 3;

export interface BranchChanges {
  changes: ChangeEntry[];
  baseCommit: string;
  targetCommit: string;
  sourceCommit: string;
}

/** Changements de `source` par rapport à `target` ; mergeBase = comme une PR (depuis l'ancêtre commun). */
export async function listBranchChanges(
  ctx: AzureContext,
  project: string,
  repoId: string,
  source: string,
  target: string,
  mode: 'mergeBase' | 'tips',
): Promise<BranchChanges> {
  const all: AzureChange[] = [];
  let skip = 0;
  let res: GitCommitDiffs;
  do {
    res = await ctx.git.getCommitDiffs(
      repoId,
      project,
      mode === 'mergeBase',
      PAGE,
      skip,
      { version: target, versionType: GitVersionType.Branch },
      { version: source, versionType: GitVersionType.Branch },
    );
    const page = (res.changes ?? []) as AzureChange[];
    all.push(...page);
    skip += page.length; // le serveur peut plafonner la page sous PAGE
  } while (res.allChangesIncluded === false && (res.changes?.length ?? 0) > 0);
  const targetCommit = res.baseCommit ?? '';
  const sourceCommit = res.targetCommit ?? '';
  return {
    changes: fromAzureDiff(all),
    targetCommit,
    sourceCommit,
    baseCommit: mode === 'mergeBase' ? (res.commonCommit ?? targetCommit) : targetCommit,
  };
}

export const EMPTY_SIDE: FileSide = { content: '', isBinary: false, tooLarge: false, sizeBytes: 0 };

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function toFileSide(buf: Buffer): FileSide {
  if (isBinaryBuffer(buf)) return { content: '', isBinary: true, tooLarge: false, sizeBytes: buf.length };
  if (buf.length > MAX_DIFF_BYTES) return { content: '', isBinary: false, tooLarge: true, sizeBytes: buf.length };
  const bom = buf.subarray(0, 3).equals(UTF8_BOM);
  const body = bom ? buf.subarray(3) : buf;
  const content = body.toString('utf8');
  // Décodage avec pertes (ex. cp1252) : le ré-encodage ne redonne pas les mêmes octets.
  const lossy = !Buffer.from(content, 'utf8').equals(body);
  return { content, isBinary: false, tooLarge: false, sizeBytes: buf.length, bom, lossy };
}

/** Contenu d'un fichier à un commit (ou une branche). Fichier absent → côté vide. */
export async function getFileSide(
  ctx: AzureContext,
  project: string,
  repoId: string,
  path: string,
  version: string,
  versionKind: 'commit' | 'branch' = 'commit',
): Promise<FileSide> {
  const versionType = versionKind === 'commit' ? GitVersionType.Commit : GitVersionType.Branch;
  try {
    // resolveLfs : contenu réel des fichiers LFS au lieu du pointeur.
    const s = await ctx.git.getItemContent(repoId, '/' + path, project, undefined, undefined, false, false, true, { version, versionType }, true, true);
    return toFileSide((await readStream(s)).body);
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) return EMPTY_SIDE;
    throw e;
  }
}

/** Fichiers d'une branche avec leur SHA blob, hors dossiers de build. */
export async function listTree(ctx: AzureContext, project: string, repoId: string, branch: string): Promise<RemoteItem[]> {
  const items = await ctx.git.getItems(repoId, project, '/', VersionControlRecursionType.Full, false, false, false, false, {
    version: branch,
    versionType: GitVersionType.Branch,
  });
  return items
    .filter((i) => (i.gitObjectType === GIT_BLOB || (i.gitObjectType as unknown) === 'blob') && i.path && i.objectId)
    .map((i) => ({ path: i.path!.replace(/^\/+/, ''), objectId: i.objectId! }))
    .filter((i) => !inExcludedDir(i.path));
}
