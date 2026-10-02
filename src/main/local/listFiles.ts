import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gitOutput, insideGitRepo } from './safeGit';

export const EXCLUDED_DIRS = ['bin', 'obj', 'node_modules', '.git', '.vs'];

/** Vrai si un des dossiers du chemin (hors nom de fichier) est exclu. */
export function inExcludedDir(path: string): boolean {
  return path.split('/').slice(0, -1).some((seg) => EXCLUDED_DIRS.includes(seg));
}

async function walk(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!EXCLUDED_DIRS.includes(e.name)) out.push(...(await walk(root, p)));
    } else if (e.isFile() || e.isSymbolicLink()) out.push(p);
  }
  return out;
}

/** Fichiers du dossier, chemins relatifs avec `/`, triés. Respecte .gitignore dans un dépôt git. */
export async function listLocalFiles(root: string): Promise<string[]> {
  let files: string[];
  if (await insideGitRepo(root)) {
    const raw = await gitOutput(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    const deleted = new Set((await gitOutput(root, ['ls-files', '--deleted', '-z'])).split('\0'));
    files = raw.split('\0').filter((f) => f && !deleted.has(f));
  } else {
    files = await walk(root);
  }
  const kept: string[] = [];
  for (const f of files) {
    if (inExcludedDir(f)) continue;
    // Les sous-modules (gitlinks) apparaissent comme des dossiers : seuls fichiers et liens sont comparés.
    try {
      const st = await lstat(join(root, f));
      if (st.isFile() || st.isSymbolicLink()) kept.push(f);
    } catch {
      /* supprimé entre-temps */
    }
  }
  return kept.sort();
}
