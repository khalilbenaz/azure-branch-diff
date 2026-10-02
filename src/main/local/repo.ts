import { realpathSync } from 'node:fs';
import type { ApiError, LocalRef, LocalRepoInfo } from '../../shared/types';
import type { RemoteItem } from '../compare/compareLocal';
import { hashLocalFiles } from './hashFiles';
import { inExcludedDir, listLocalFiles } from './listFiles';
import { gitOutput } from './safeGit';

const fail = (message: string): ApiError => ({ code: 'unknown', message });

/** Racine réelle du dépôt git contenant `dir`. */
export async function repoRoot(dir: string): Promise<string> {
  try {
    return realpathSync.native((await gitOutput(dir, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    throw fail('Ce dossier n’est pas un dépôt git (ou git n’est pas installé).');
  }
}

/** Nom de branche valide et sans risque d'être lu comme une option ou une plage. */
function checkName(name: string): string {
  if (!name || name.startsWith('-') || name.includes('..') || /[\s~^:?*[\\\0]/.test(name) || name.endsWith('/') || name.endsWith('.lock')) {
    throw fail(`Nom de branche invalide : ${name}`);
  }
  return name;
}

export function refSpec(ref: LocalRef): string {
  if (ref.type === 'worktree') return 'HEAD';
  return ref.type === 'branch' ? `refs/heads/${checkName(ref.name)}` : `refs/remotes/origin/${checkName(ref.name)}`;
}

export function refName(ref: LocalRef): string {
  if (ref.type === 'worktree') return 'copie de travail';
  return ref.type === 'branch' ? ref.name : `origin/${ref.name}`;
}

export async function resolveCommit(root: string, ref: LocalRef): Promise<string> {
  try {
    return (await gitOutput(root, ['rev-parse', '--verify', '--quiet', `${refSpec(ref)}^{commit}`])).trim();
  } catch (e) {
    if ((e as ApiError).code) throw e;
    throw fail(`Référence introuvable : ${refName(ref)}`);
  }
}

/** Fichiers d'une référence avec leur SHA blob (copie de travail : fichiers sur disque). */
export async function localTree(root: string, ref: LocalRef): Promise<RemoteItem[]> {
  if (ref.type === 'worktree') {
    const hashes = await hashLocalFiles(root, await listLocalFiles(root));
    return [...hashes].map(([path, objectId]) => ({ path, objectId }));
  }
  const commit = await resolveCommit(root, ref);
  const out = await gitOutput(root, ['ls-tree', '-r', '-z', '--full-tree', commit]);
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [, type, objectId] = line.slice(0, tab).split(' ');
      return { type, objectId, path: line.slice(tab + 1) };
    })
    .filter((i) => i.type === 'blob' && !inExcludedDir(i.path))
    .map(({ path, objectId }) => ({ path, objectId }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function refs(root: string, prefix: string): Promise<string[]> {
  const out = await gitOutput(root, ['for-each-ref', '--format=%(refname)', prefix]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((r) => r.slice(prefix.length))
    .filter((r) => r !== 'HEAD')
    .sort();
}

export async function repoInfo(root: string): Promise<LocalRepoInfo> {
  const [branches, remoteBranches, status, current, origin] = await Promise.all([
    refs(root, 'refs/heads/'),
    refs(root, 'refs/remotes/origin/'),
    gitOutput(root, ['status', '--porcelain=v1', '-z']),
    gitOutput(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
    gitOutput(root, ['config', '--get', 'remote.origin.url']).catch(() => ''),
  ]);
  return {
    root,
    current: current.trim() || null,
    dirty: status.length > 0,
    branches,
    remoteBranches,
    // Jamais d'identifiants (https://user:token@…) vers l'interface.
    originUrl: origin.trim().replace(/^(\w+:\/\/)\S*@/, '$1***@') || null,
  };
}
