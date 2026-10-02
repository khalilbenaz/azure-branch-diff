import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiError, LocalRef, LocalRepoInfo } from '../../shared/types';
import type { RemoteItem } from '../compare/compareLocal';
import { hashLocalFiles } from './hashFiles';
import { inExcludedDir, listLocalFiles } from './listFiles';
import { gitOutput, gitRun } from './safeGit';

const fail = (message: string): ApiError => ({ code: 'unknown', message });

/** Sous-dossiers directs qui sont des dépôts git (le dossier choisi en contient peut-être plusieurs). */
function childRepos(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, '.git')))
      .map((e) => e.name)
      .sort()
      .slice(0, 8);
  } catch {
    return [];
  }
}

/** Racine réelle du dépôt git contenant `dir`, avec un message qui dit pourquoi ce n'en est pas un. */
export async function repoRoot(dir: string): Promise<string> {
  let r;
  try {
    r = await gitRun(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw fail('git est introuvable : installez git (ou les outils en ligne de commande Xcode sur macOS) puis relancez l’app.');
  }
  if (r.code === 0) return realpathSync.native(r.stdout.trim());
  if (/dubious ownership/i.test(r.stderr)) {
    throw fail(`git refuse ce dépôt car il appartient à un autre utilisateur : ${dir}. Si vous lui faites confiance : git config --global --add safe.directory "${dir}"`);
  }
  const repos = childRepos(dir);
  if (repos.length) throw fail(`« ${dir} » n’est pas un dépôt git, mais il en contient : ${repos.join(', ')}. Choisissez l’un d’eux.`);
  throw fail(`« ${dir} » n’est pas un dépôt git : choisissez le dossier racine d’un clone (celui qui contient .git).`);
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

/**
 * Dossier choisi par l'utilisateur : dépôt git (sa racine exacte) ou dossier simple (archive téléchargée, export,
 * ou git absent). Un sous-dossier de dépôt reste refusé : il faut choisir la racine.
 */
export async function inspectFolder(dir: string): Promise<LocalRepoInfo> {
  let r;
  try {
    r = await gitRun(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    r = null; // git absent : dossier simple
  }
  if (r && r.code === 0) {
    const root = realpathSync.native(r.stdout.trim());
    if (root !== dir) throw fail(`Choisissez la racine du dépôt : ${root}`);
    return repoInfo(root);
  }
  return { root: dir, git: false, current: null, dirty: false, branches: [], remoteBranches: [], originUrl: null };
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
    git: true,
    current: current.trim() || null,
    dirty: status.length > 0,
    branches,
    remoteBranches,
    // Jamais d'identifiants (https://user:token@…) vers l'interface.
    originUrl: origin.trim().replace(/^(\w+:\/\/)\S*@/, '$1***@') || null,
  };
}
