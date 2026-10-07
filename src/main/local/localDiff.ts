import { readFile } from 'node:fs/promises';
import type { ChangeEntry, ChangeType, FileSide, LocalRef } from '../../shared/types';
import { EMPTY_SIDE, toFileSide } from '../azure/diff';
import { assertNotGitDir, insideRoot } from '../paths';
import { inExcludedDir } from './listFiles';
import { resolveCommit } from './repo';
import { gitBuffer, gitOutput } from './safeGit';

export const WORKTREE = 'WORKTREE';

export interface LocalChanges {
  changes: ChangeEntry[];
  /** Commit de gauche (cible, ou ancêtre commun en mode PR). */
  baseCommit: string;
  /** Commit de droite, ou WORKTREE pour la copie de travail. */
  headCommit: string;
  /** Tête de la cible (affichée à gauche, même en mode PR). */
  targetTip: string;
}

const KIND: Record<string, ChangeType> = { A: 'add', C: 'add', M: 'edit', T: 'edit', D: 'delete', R: 'rename' };

/** Analyse la sortie `git diff --name-status -z`. */
function parseNameStatus(out: string): ChangeEntry[] {
  const parts = out.split('\0');
  const res: ChangeEntry[] = [];
  for (let i = 0; i < parts.length - 1; ) {
    const status = parts[i++];
    const kind = KIND[status[0]];
    if (!kind) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const from = parts[i++];
      const to = parts[i++];
      res.push(kind === 'rename' ? { path: to, originalPath: from, change: 'rename', isBinary: false } : { path: to, change: kind, isBinary: false });
    } else {
      res.push({ path: parts[i++], change: kind, isBinary: false });
    }
  }
  return res;
}

/** Changements de `head` par rapport à `base` dans un même clone (« Comme une PR » : depuis l'ancêtre commun). */
export async function listLocalChanges(root: string, base: LocalRef, head: LocalRef, mode: 'mergeBase' | 'tips'): Promise<LocalChanges> {
  const baseTip = await resolveCommit(root, base);
  const headTip = await resolveCommit(root, head); // worktree → HEAD
  const left = mode === 'mergeBase' ? (await gitOutput(root, ['merge-base', baseTip, headTip])).trim() : baseTip;
  let changes: ChangeEntry[];
  if (head.type === 'worktree') {
    changes = parseNameStatus(await gitOutput(root, ['diff', '--name-status', '-z', '-M', left, '--']));
    const untracked = (await gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    changes.push(...untracked.map((path): ChangeEntry => ({ path, change: 'add', isBinary: false })));
  } else {
    changes = parseNameStatus(await gitOutput(root, ['diff', '--name-status', '-z', '-M', left, headTip, '--']));
  }
  return {
    changes: changes.filter((c) => !inExcludedDir(c.path)).sort((a, b) => a.path.localeCompare(b.path)),
    baseCommit: left,
    targetTip: baseTip,
    headCommit: head.type === 'worktree' ? WORKTREE : headTip,
  };
}

/** Contenu d'un fichier à un commit (git show) ou dans la copie de travail. Absent → côté vide. */
export async function localFileSide(root: string, commit: string, path: string): Promise<FileSide> {
  assertNotGitDir(path);
  if (commit === WORKTREE) {
    try {
      return toFileSide(await readFile(insideRoot(root, path)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_SIDE;
      throw e;
    }
  }
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error('Commit invalide.');
  const spec = `${commit}:${path}`;
  const exists = await gitOutput(root, ['cat-file', '-e', spec]).then(
    () => true,
    () => false,
  );
  return exists ? toFileSide(await gitBuffer(root, ['show', spec])) : EMPTY_SIDE;
}
