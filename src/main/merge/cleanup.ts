import { lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitRun } from '../local/safeGit';
import { TMP_PREFIX } from './session';

const STALE_MS = 10 * 60_000;

/** Dossier de merge créé par l'app : directement dans le dossier temporaire, préfixe connu, pas un lien, à l'utilisateur courant. */
function isOurTmpDir(path: string): boolean {
  try {
    const tmp = realpathSync(tmpdir());
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
    const real = realpathSync(path);
    return dirname(real) === tmp && real.slice(tmp.length + 1).startsWith(TMP_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Supprime les worktrees de merge laissés par un arrêt brutal, dans les clones connus, puis les dossiers temporaires
 * anciens. Seuls les dossiers créés par l'app (voir isOurTmpDir) sont touchés, quoi que contienne le dépôt.
 */
export async function cleanupStaleMerges(roots: string[]): Promise<void> {
  for (const root of roots) {
    const list = await gitRun(root, ['worktree', 'list', '--porcelain']);
    if (list.code !== 0) continue;
    const stale = list.stdout
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length))
      .filter(isOurTmpDir);
    for (const dir of stale) {
      await gitRun(root, ['worktree', 'remove', '--force', dir]);
      rmSync(dir, { recursive: true, force: true });
    }
    await gitRun(root, ['worktree', 'prune']);
  }
  const now = Date.now();
  for (const d of readdirSync(tmpdir())) {
    if (!d.startsWith(TMP_PREFIX)) continue;
    const dir = join(tmpdir(), d);
    try {
      if (isOurTmpDir(dir) && now - lstatSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* déjà supprimé */
    }
  }
}
